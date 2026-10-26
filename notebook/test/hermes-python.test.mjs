import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {hermesPython,hermesPythons} from '../core/runtime.mjs';

// The model list under the chat runs a small helper with the Python Hermes runs on
// (assistant-files/chat-options.py). Until 18 October 2026 that Python was looked for only where the
// one-click server's image keeps it, so on a Linux or Mac computer the chat said "Model choices could
// not be loaded" under the message box.
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hermes-python-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const file=(p,text='')=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);return p;};

test('on a Linux or Mac computer, the Python is the one Hermes\' own launcher names',t=>{
 const root=temporary(t),source=path.join(root,'.hermes','hermes-agent'),python=file(path.join(source,'venv','bin','python'));file(path.join(source,'hermes'),'# entrypoint\n');
 const launcher=file(path.join(root,'.local','bin','hermes'),'#!/usr/bin/env bash\nunset PYTHONPATH\nunset PYTHONHOME\nexec "'+python+'" "'+path.join(source,'hermes')+'" "$@"\n');
 assert.deepEqual(hermesPython({executable:launcher,home:path.join(root,'.hermes'),platform:'linux'}),{python,source});
});

test('in the server image, the Python is the one beside Hermes in .venv',t=>{
 const root=temporary(t),python=file(path.join(root,'opt','hermes','.venv','bin','python3')),hermes=file(path.join(root,'opt','hermes','bin','hermes'),'#!/bin/sh\nexec something\n');
 assert.deepEqual(hermesPython({executable:hermes,platform:'linux'}),{python,source:path.join(root,'opt','hermes')});
});

test('an older Hermes whose command is the venv\'s own script names its Python on its first line',{skip:process.platform==='win32'&&'needs a POSIX path on the first line'},t=>{
 const root=temporary(t),python=file(path.join(root,'agent','venv','bin','python3')),script=file(path.join(root,'agent','venv','bin','hermes'),'#!'+python+'\nimport sys\n');
 const link=path.join(root,'bin','hermes');fs.mkdirSync(path.dirname(link),{recursive:true});fs.symlinkSync(script,link);
 assert.equal(hermesPython({executable:link,platform:'linux'}).python,python);
});

test('no Python found means no model list, never a guess',t=>{
 const root=temporary(t),hermes=file(path.join(root,'bin','hermes'),'#!/bin/sh\n');
 assert.equal(hermesPython({executable:hermes,platform:'linux'}).python,null);
});

test('on Windows, the Python is in the venv of the Hermes source the installer recorded',t=>{
 const root=temporary(t),python=file(path.join(root,'hermes-agent','venv','Scripts','python.exe'));
 assert.deepEqual(hermesPython({executable:path.join(root,'hermes-agent','venv','Scripts','hermes.exe'),sourceRoot:path.join(root,'hermes-agent'),platform:'win32'}),{python,source:path.join(root,'hermes-agent')});
 assert.equal(hermesPython({executable:path.join(root,'x','hermes.exe'),sourceRoot:path.join(root,'missing'),platform:'win32'}).python,null);
});

test('Hermes 0.22: a launcher hands on to the source\'s own launcher, which runs a Python of its own with the source first on its path',t=>{
 const root=temporary(t),source=path.join(root,'.hermes','hermes-agent');file(path.join(source,'hermes_cli','__init__.py'));
 const python=file(path.join(root,'.hermes','tools','python-3.14.7+20260901-linux-x64','bin','python3'));
 const inner=file(path.join(source,'.hermes','bin','hermes'),"#!/bin/sh\nexec "+python+" -I -c 'import os, re, sys\nsys.path.insert(0, '\"'\"'"+source+"'\"'\"')\nfrom hermes_cli.main import main\n' \"$@\"\n");
 const outer=file(path.join(root,'.local','bin','hermes'),'#!/bin/sh\nexec '+inner+' "$@"\n');
 assert.deepEqual(hermesPython({executable:outer,home:path.join(root,'.hermes'),platform:'linux'}),{python,source});
});

// 26 October 2026, a server updated as root: root's own `hermes` handed on to the launcher of a
// Hermes another account owns, whose managed Python could not load Hermes as root, while the source's
// own venv did. Every Python of that one Hermes is a candidate, the launcher's first, the source's venv
// last; the add-on connection tries them in order (core/addon-model.mjs).
test('every Python of the one Hermes, the launcher\'s first and its source\'s own venv after it',t=>{
 const root=temporary(t),source=path.join(root,'opt','hermes-src');file(path.join(source,'hermes_cli','__init__.py'));
 const managed=file(path.join(source,'.hermes','tools','python-3.14.7','bin','python3')),venv=file(path.join(source,'venv','bin','python3'));
 const inner=file(path.join(source,'.hermes','bin','hermes'),"#!/bin/sh\nexec "+managed+" -I -c 'import sys\nsys.path.insert(0, '\"'\"'"+source+"'\"'\"')\nimport hermes_bootstrap\n' \"$@\"\n");
 const outer=file(path.join(root,'root','.local','bin','hermes'),'#!/bin/sh\nexec '+inner+' "$@"\n');
 assert.deepEqual(hermesPythons({executable:outer,home:path.join(root,'root','.hermes'),platform:'linux'}),{pythons:[managed,venv],source});
 assert.deepEqual(hermesPython({executable:outer,home:path.join(root,'root','.hermes'),platform:'linux'}),{python:managed,source},'the first one is still the model list\'s');
});
