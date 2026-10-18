"""Candidate-only file authority for the isolated native assistant's SQLite state."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import uuid
from urllib.parse import urlsplit, parse_qs, unquote


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def cell(value):
    return {'$blob': base64.b64encode(value).decode('ascii')} if isinstance(value, bytes) else value


def uncell(value):
    return base64.b64decode(value['$blob']) if isinstance(value, dict) and set(value) == {'$blob'} else value


def keyword(sql):
    text = re.sub(r'^(?:\s|--[^\n]*\n|/\*.*?\*/)*', '', sql, flags=re.S)
    match = re.match(r'[a-zA-Z]+', text)
    return match[0].upper() if match else ''


# Format 2 (6 October 2026): the database file holds the schema and a list of
# parts; each table's rows live in parts of BUCKET row ids, and a save rewrites
# only the parts whose rows changed. Format 1 rewrote the whole history, 35 MB
# on a working server, for every message, and kept a full copy of each version.
BUCKET = 32


def part_key(name):
    return (re.sub(r'[^a-z0-9_]', '_', name.lower())[:40] or 'table') + '-' + digest(name)[:6]


def literal(text):
    return "'" + text.replace("'", "''") + "'"


def activate():
    home = Path(os.environ['HERMES_HOME']).resolve()
    root = Path(os.environ['GODSPEED_WORKSPACE']).resolve()
    publisher = os.environ['GODSPEED_ASSISTANT_PUBLISHER']
    node = os.environ['GODSPEED_NODE']
    home.mkdir(parents=True, exist_ok=True)
    identity = home / 'godspeed-file-profile.json'
    try:
        with identity.open('x', encoding='utf-8') as f:
            json.dump({'id': str(uuid.uuid4()), 'format': 1}, f)
            f.flush()
            os.fsync(f.fileno())
    except FileExistsError:
        pass
    profile = json.loads(identity.read_text(encoding='utf-8-sig'))['id']
    uuid.UUID(profile)
    original = sqlite3.connect

    class Cursor(sqlite3.Cursor):
        def execute(self, sql, parameters=()):
            conn = self.connection
            operation = keyword(sql)
            if operation in ('COMMIT', 'END'):
                conn.commit()
                return self
            if operation == 'ROLLBACK' and not re.search(r'\bTO\b', sql, re.I):
                conn.rollback()
                return self
            automatic = operation in ('INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'DROP', 'ALTER', 'SAVEPOINT') or (operation == 'PRAGMA' and re.search(r'user_version\s*=', sql, re.I))
            own = automatic and not conn.in_transaction
            if own:
                conn._raw('BEGIN IMMEDIATE')
                conn._refresh()
            try:
                result = super().execute(sql, parameters)
                if operation == 'BEGIN':
                    conn._refresh()
                # SAVEPOINT is nested under our outer transaction. RELEASE cannot
                # acknowledge state before the authoritative file is published.
                if own and operation != 'SAVEPOINT':
                    conn.commit()
                return result
            except BaseException:
                if own:
                    conn.rollback()
                raise

        def executemany(self, sql, parameters):
            own = not self.connection.in_transaction
            if own:
                self.connection._raw('BEGIN IMMEDIATE')
                self.connection._refresh()
            try:
                result = super().executemany(sql, parameters)
                if own:
                    self.connection.commit()
                return result
            except BaseException:
                if own:
                    self.connection.rollback()
                raise

        def executescript(self, script):
            # sqlite3.executescript commits implicitly. Execute complete statements
            # individually so a script never bypasses the file-first commit path.
            statement = ''
            for char in script:
                statement += char
                if char == ';' and sqlite3.complete_statement(statement):
                    self.execute(statement)
                    statement = ''
            if statement.strip():
                self.execute(statement)
            return self

    class Files:
        def _raw(self, sql, args=()):
            return sqlite3.Cursor(self).execute(sql, args)

        def cursor(self, factory=Cursor):
            if factory is not Cursor:
                raise RuntimeError('A custom assistant cursor requires file-state compatibility')
            return super().cursor(factory)

        def execute(self, sql, parameters=()):
            return self.cursor().execute(sql, parameters)

        def executemany(self, sql, parameters):
            return self.cursor().executemany(sql, parameters)

        def executescript(self, sql):
            return self.cursor().executescript(sql)

        def _refresh(self):
            # Publication compares exact bytes. Universal newline translation on
            # Windows made a synced CRLF file look like an unrelated write.
            text = self._file.read_bytes().decode('utf-8') if self._file.exists() else None
            current = digest(text) if text is not None else None
            try:
                cached = self._raw('SELECT hash FROM _godspeed_file_version LIMIT 1').fetchone()
            except sqlite3.OperationalError:
                cached = None
            if text is not None and (not cached or cached[0] != current):
                snapshot = json.loads(text)
                if snapshot['format'] not in (1, 2) or snapshot['profile'] != profile or snapshot['database'] != self._relative:
                    raise RuntimeError('Invalid authoritative assistant state identity')
                self._restore(snapshot)
            elif text is None and cached and cached[0]:
                raise RuntimeError('The authoritative assistant file is missing; restore it before continuing')
            self._base = text
            self._expected = current
            self._track()
            self._transaction_version = self._write_version()

        def _write_version(self):
            # SQLite counts row writes, schema changes and user-version updates
            # independently. Read-only or unchanged IF NOT EXISTS startup work
            # must not re-serialize every retained message on every statement.
            return (self.total_changes,
                    self._raw('PRAGMA schema_version').fetchone()[0],
                    self._raw('PRAGMA user_version').fetchone()[0])

        def blobopen(self, *args, **kwargs):
            # Incremental blob writes do not advance total_changes. Once used,
            # keep the conservative full snapshot path for this connection.
            self._untracked_writes = True
            return super().blobopen(*args, **kwargs)

        def deserialize(self, *args, **kwargs):
            self._untracked_writes = True
            return super().deserialize(*args, **kwargs)

        def _schema(self):
            kinds = {r[1]: r[2] for r in self._raw('PRAGMA table_list').fetchall() if r[0] == 'main'}
            virtual = [name for name, kind in kinds.items() if kind in ('virtual', 'shadow')]
            schema = self._raw("SELECT type,name,tbl_name,sql FROM main.sqlite_master WHERE sql IS NOT NULL ORDER BY name").fetchall()
            tables = [(name, sql) for kind, name, _, sql in schema if kind == 'table' and name != '_godspeed_file_version' and kinds.get(name) == 'table']
            objects = [dict(kind=kind, name=name, sql=sql) for kind, name, table, sql in schema if kind in ('index', 'trigger', 'view') and table not in virtual and not any(re.search(r'\b' + re.escape(v) + r'\b', sql) for v in virtual)]
            return tables, objects

        def _columns(self, name):
            return [r[1] for r in self._raw('PRAGMA table_info(' + quote(name) + ')').fetchall()]

        def _has_rowid(self, name):
            try:
                self._raw('SELECT rowid FROM ' + quote(name) + ' LIMIT 0')
                return True
            except sqlite3.OperationalError:
                return False

        def _snapshot(self):
            # The whole database as format 1: what a conflict keeps, and what
            # older versions of this file read.
            tables, objects = self._schema()
            out = []
            for name, sql in tables:
                cols = self._columns(name)
                rows = [[cell(v) for v in row] for row in self._raw('SELECT ' + ','.join(map(quote, cols)) + ' FROM ' + quote(name)).fetchall()]
                rows.sort(key=lambda row: json.dumps(row, sort_keys=True, ensure_ascii=False))
                out.append({'name': name, 'sql': sql, 'columns': cols, 'rows': rows})
            return dict(format=1, profile=profile, database=self._relative, schema_version=self._raw('PRAGMA user_version').fetchone()[0], tables=out, objects=objects)

        def _track(self):
            # Temporary triggers note which row-id buckets this connection
            # changes; they vanish with the connection and never reach the file.
            self._raw('CREATE TEMP TABLE IF NOT EXISTS _godspeed_dirty(tbl TEXT, bucket INTEGER)')
            existing = {r[0] for r in self._raw("SELECT name FROM temp.sqlite_master WHERE type='trigger'").fetchall()}
            for name, _ in self._schema()[0]:
                if name == 'sqlite_sequence':
                    continue
                rowid = self._has_rowid(name)
                for event, refs in (('INSERT', ('NEW',)), ('UPDATE', ('OLD', 'NEW')), ('DELETE', ('OLD',))):
                    trigger = '_godspeed_' + digest(name)[:12] + '_' + event.lower()
                    if trigger in existing:
                        continue
                    body = ''.join('INSERT INTO _godspeed_dirty VALUES(' + literal(name) + ',' + (ref + '.rowid/' + str(BUCKET) if rowid else '0') + ');' for ref in refs)
                    self._raw('CREATE TEMP TRIGGER ' + quote(trigger) + ' AFTER ' + event + ' ON main.' + quote(name) + ' BEGIN ' + body + ' END')

        def _part_rows(self, name, cols, rowid, bucket):
            select = 'SELECT ' + ','.join(map(quote, cols)) + ' FROM ' + quote(name)
            if rowid:
                found = self._raw(select + ' WHERE rowid >= ? AND rowid < ? ORDER BY rowid', (bucket * BUCKET, (bucket + 1) * BUCKET)).fetchall()
                return [[cell(v) for v in row] for row in found]
            rows = [[cell(v) for v in row] for row in self._raw(select).fetchall()]
            rows.sort(key=lambda row: json.dumps(row, sort_keys=True, ensure_ascii=False))
            return rows

        def _changes(self, full):
            # The new database file and the parts to write or delete.
            old = json.loads(self._base) if self._base else None
            previous = {t['name']: t for t in old['tables']} if old and old.get('format') == 2 else {}
            full = full or not previous
            dirty = {}
            for name, bucket in self._raw('SELECT DISTINCT tbl, bucket FROM temp._godspeed_dirty').fetchall():
                dirty.setdefault(name, set()).add(bucket)
            folder = self._portable[:-len('.json')]
            tables, objects = self._schema()
            out, parts = [], []
            for name, sql in tables:
                cols = self._columns(name)
                entry = {'name': name, 'sql': sql, 'columns': cols}
                if name == 'sqlite_sequence':
                    entry['rows'] = sorted(([cell(v) for v in row] for row in self._raw('SELECT name, seq FROM sqlite_sequence').fetchall()), key=lambda r: json.dumps(r, ensure_ascii=False))
                    out.append(entry)
                    continue
                rowid = self._has_rowid(name)
                prev = previous.get(name)
                known = {p['bucket']: p for p in (prev or {}).get('parts', [])} if prev and prev.get('sql') == sql and prev.get('columns') == cols else {}
                if full or not known:
                    buckets = {r[0] for r in self._raw('SELECT DISTINCT rowid/' + str(BUCKET) + ' FROM ' + quote(name)).fetchall()} if rowid else {0}
                    buckets |= {p['bucket'] for p in (prev or {}).get('parts', [])}
                else:
                    buckets = dirty.get(name, set())
                kept = dict(known)
                for bucket in sorted(buckets):
                    rows = self._part_rows(name, cols, rowid, bucket)
                    file = folder + '/' + part_key(name) + '-' + str(bucket) + '.json'
                    if not rows:
                        if prev is not None and any(p['bucket'] == bucket for p in prev.get('parts', [])):
                            parts.append({'file': file, 'delete': True})
                        kept.pop(bucket, None)
                        continue
                    text = json.dumps({'format': 2, 'table': name, 'bucket': bucket, 'rows': rows}, ensure_ascii=False, sort_keys=True) + '\n'
                    part = {'bucket': bucket, 'file': file, 'hash': digest(text), 'rows': len(rows)}
                    if known.get(bucket, {}).get('hash') != part['hash']:
                        parts.append({'file': file, 'text': text})
                    kept[bucket] = part
                entry['parts'] = [kept[b] for b in sorted(kept)]
                out.append(entry)
            # A table that is gone takes its parts with it.
            for name, prev in previous.items():
                if name not in {n for n, _ in tables}:
                    parts.extend({'file': p['file'], 'delete': True} for p in prev.get('parts', []))
            manifest = dict(format=2, profile=profile, database=self._relative, schema_version=self._raw('PRAGMA user_version').fetchone()[0], tables=out, objects=objects)
            return json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=1) + '\n', parts

        def _rows_of(self, table):
            # A table's rows from a format 1 file, or from a format 2 file's parts.
            if 'rows' in table:
                return table['rows']
            rows = []
            for part in table.get('parts', []):
                text = (root / part['file']).read_bytes().decode('utf-8')
                if digest(text) != part['hash']:
                    raise RuntimeError('An assistant state part changed outside its file list: ' + part['file'])
                rows.extend(json.loads(text)['rows'])
            return rows

        def _restore(self, snapshot):
            self._raw('PRAGMA defer_foreign_keys=ON')
            objects = self._raw("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").fetchall()
            kinds = {r[1]: r[2] for r in self._raw('PRAGMA table_list').fetchall() if r[0] == 'main'}
            for kind, name, _ in objects:
                if kind in ('trigger', 'view'):
                    self._raw('DROP ' + kind.upper() + ' IF EXISTS ' + quote(name))
            for kind, name, _ in sorted(objects, key=lambda r: kinds.get(r[1]) != 'virtual'):
                if kind == 'table' and kinds.get(name) != 'shadow':
                    self._raw('DROP TABLE IF EXISTS ' + quote(name))
            for table in snapshot['tables']:
                if table['name'] == 'sqlite_sequence':
                    continue
                if keyword(table['sql']) != 'CREATE' or not re.match(r'CREATE\s+TABLE\b', table['sql'], re.I):
                    raise RuntimeError('Invalid assistant table schema')
                self._raw(table['sql'])
            for table in snapshot['tables']:
                if table['name'] == 'sqlite_sequence':
                    self._raw('DELETE FROM sqlite_sequence')
                sql = 'INSERT INTO ' + quote(table['name']) + '(' + ','.join(map(quote, table['columns'])) + ') VALUES (' + ','.join('?' for _ in table['columns']) + ')'
                for row in self._rows_of(table):
                    self._raw(sql, [uncell(v) for v in row])
            for obj in snapshot['objects']:
                if keyword(obj['sql']) != 'CREATE':
                    raise RuntimeError('Invalid assistant schema object')
                self._raw(obj['sql'])
            self._raw('PRAGMA user_version=' + str(int(snapshot['schema_version'])))

        def commit(self):
            try:
                if self.in_transaction:
                    version = self._write_version()
                    unchanged = (self._base is not None
                                 and not getattr(self, '_untracked_writes', False)
                                 and getattr(self, '_transaction_version', None) == version)
                    if unchanged:
                        text, parts = self._base, []
                    else:
                        # A schema change or an untracked write rereads every table;
                        # otherwise only the buckets this connection changed.
                        full = getattr(self, '_untracked_writes', False) or getattr(self, '_transaction_version', None) is None or self._transaction_version[1:] != version[1:]
                        text, parts = self._changes(full)
                    if text != self._base or parts:
                        request = json.dumps(dict(file=self._portable, expected=self._expected, base=self._base, text=text, parts=parts))
                        result = subprocess.run([node, publisher], input=request, encoding='utf-8', capture_output=True, env=os.environ, timeout=60)
                        if result.returncode:
                            raise RuntimeError('Assistant file publication failed: ' + result.stderr[-1200:])
                        self._expected = digest(text)
                        self._base = text
                    self._raw('CREATE TABLE IF NOT EXISTS _godspeed_file_version(hash TEXT)')
                    self._raw('DELETE FROM _godspeed_file_version')
                    self._raw('INSERT INTO _godspeed_file_version VALUES (?)', (self._expected,))
                    self._raw('DELETE FROM temp._godspeed_dirty')
                return super().commit()
            except BaseException:
                super().rollback()
                raise

        def __exit__(self, kind, value, traceback):
            if kind is None:
                self.commit()
            else:
                self.rollback()
            return False

    def connect(database, *args, **kwargs):
        value = os.fspath(database)
        if value == ':memory:':
            return original(database, *args, **kwargs)
        if value.startswith('file:'):
            uri = urlsplit(value)
            mode = parse_qs(uri.query).get('mode', ['rw'])[0]
            if mode in ('ro', 'memory'):
                return original(database, *args, **kwargs)
            value = unquote(uri.path)
            if os.name == 'nt' and re.match(r'^/[a-zA-Z]:', value):
                value = value[1:]
        file = Path(value).resolve()
        try:
            relative = file.relative_to(home).as_posix()
        except ValueError:
            return original(database, *args, **kwargs)
        if not relative.endswith('.db'):
            return original(database, *args, **kwargs)
        factory = kwargs.pop('factory', sqlite3.Connection)
        kwargs['factory'] = type('File' + factory.__name__, (Files, factory), {})
        conn = original(database, *args, **kwargs)
        conn._relative = relative
        conn._portable = 'assistant-state/' + profile + '/' + digest(relative)[:16] + '.json'
        conn._file = root / conn._portable
        conn._base = None
        conn._expected = None
        conn._raw('BEGIN IMMEDIATE')
        try:
            conn._refresh()
            # Opening an empty database is not a new durable user event.
            if conn._base is not None:
                conn._raw('CREATE TABLE IF NOT EXISTS _godspeed_file_version(hash TEXT)')
                conn._raw('DELETE FROM _godspeed_file_version')
                conn._raw('INSERT INTO _godspeed_file_version VALUES (?)', (conn._expected,))
            sqlite3.Connection.commit(conn)
        except BaseException:
            sqlite3.Connection.rollback(conn)
            conn.close()
            raise
        return conn

    sqlite3.connect = connect


if os.environ.get('GODSPEED_FILE_HERMES') == '1':
    # sitecustomize exceptions normally let Python continue without the adapter.
    # Fail closed rather than silently reverting to database authority.
    try:
        activate()
    except BaseException as error:
        import sys
        print('Candidate assistant file storage could not start: ' + str(error), file=sys.stderr)
        os._exit(78)
