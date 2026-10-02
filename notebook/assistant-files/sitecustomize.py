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
            text = self._file.read_text(encoding='utf-8') if self._file.exists() else None
            current = digest(text) if text is not None else None
            try:
                cached = self._raw('SELECT hash FROM _godspeed_file_version LIMIT 1').fetchone()
            except sqlite3.OperationalError:
                cached = None
            if text is not None and (not cached or cached[0] != current):
                snapshot = json.loads(text)
                if snapshot['format'] != 1 or snapshot['profile'] != profile or snapshot['database'] != self._relative:
                    raise RuntimeError('Invalid authoritative assistant state identity')
                self._restore(snapshot)
            elif text is None and cached and cached[0]:
                raise RuntimeError('The authoritative assistant file is missing; restore it before continuing')
            self._base = text
            self._expected = current

        def _snapshot(self):
            tables = []
            kinds = {r[1]: r[2] for r in self._raw('PRAGMA table_list').fetchall() if r[0] == 'main'}
            virtual = [name for name, kind in kinds.items() if kind in ('virtual', 'shadow')]
            schema = self._raw("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").fetchall()
            for kind, name, _, sql in schema:
                if kind != 'table' or name == '_godspeed_file_version' or kinds.get(name) != 'table':
                    continue
                cols = [r[1] for r in self._raw('PRAGMA table_info(' + quote(name) + ')').fetchall()]
                rows = [[cell(v) for v in row] for row in self._raw('SELECT ' + ','.join(map(quote, cols)) + ' FROM ' + quote(name)).fetchall()]
                rows.sort(key=lambda row: json.dumps(row, sort_keys=True, ensure_ascii=False))
                tables.append({'name': name, 'sql': sql, 'columns': cols, 'rows': rows})
            objects = [dict(kind=kind, name=name, sql=sql) for kind, name, table, sql in schema if kind in ('index', 'trigger', 'view') and table not in virtual and not any(re.search(r'\b' + re.escape(v) + r'\b', sql) for v in virtual)]
            return dict(format=1, profile=profile, database=self._relative, schema_version=self._raw('PRAGMA user_version').fetchone()[0], tables=tables, objects=objects)

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
                for row in table['rows']:
                    self._raw(sql, [uncell(v) for v in row])
            for obj in snapshot['objects']:
                if keyword(obj['sql']) != 'CREATE':
                    raise RuntimeError('Invalid assistant schema object')
                self._raw(obj['sql'])
            self._raw('PRAGMA user_version=' + str(int(snapshot['schema_version'])))

        def commit(self):
            try:
                if self.in_transaction:
                    text = json.dumps(self._snapshot(), ensure_ascii=False, sort_keys=True, indent=2) + '\n'
                    if text != self._base:
                        request = json.dumps(dict(file=self._portable, expected=self._expected, base=self._base, text=text))
                        result = subprocess.run([node, publisher], input=request, encoding='utf-8', capture_output=True, env=os.environ, timeout=60)
                        if result.returncode:
                            raise RuntimeError('Assistant file publication failed: ' + result.stderr[-1200:])
                        self._expected = digest(text)
                        self._base = text
                    self._raw('CREATE TABLE IF NOT EXISTS _godspeed_file_version(hash TEXT)')
                    self._raw('DELETE FROM _godspeed_file_version')
                    self._raw('INSERT INTO _godspeed_file_version VALUES (?)', (self._expected,))
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
