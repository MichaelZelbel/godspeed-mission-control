import test from 'node:test';
import assert from 'node:assert/strict';
import {publicAddresses,publicIPv4,hostName,serverName,dnsServers} from '../scripts/server-address.mjs';

const dns=records=>({resolve4:async name=>{if(!(name in records))throw Object.assign(new Error('not found'),{code:'ENOTFOUND'});return records[name];},reverse:async address=>{const names=Object.entries(records).filter(([n,a])=>n.startsWith('ptr:')&&a.includes(address)).map(([n])=>n.slice(4));if(!names.length)throw Object.assign(new Error('not found'),{code:'ENOTFOUND'});return names;}});

test('only an address the internet can reach counts as public',()=>{
  for(const address of ['76.13.139.122','8.8.8.8','5.75.1.2'])assert.equal(publicIPv4(address),true,address);
  for(const address of ['10.0.0.4','172.17.0.1','172.31.255.1','192.168.1.20','100.114.115.126','127.0.1.1','169.254.1.1','0.0.0.0','203.0.113.9','fd7a::1'])assert.equal(publicIPv4(address),false,address);
  const interfaces={lo:[{address:'127.0.0.1',family:'IPv4',internal:true}],eth0:[{address:'76.13.139.122',family:'IPv4',internal:false},{address:'2a02:4780::1',family:'IPv6',internal:false}],docker0:[{address:'172.17.0.1',family:'IPv4',internal:false}],tailscale0:[{address:'100.114.115.126',family:'IPv4',internal:false}]};
  assert.deepEqual(publicAddresses(interfaces),['76.13.139.122']);
  assert.deepEqual(publicAddresses({eth0:[{address:'10.1.0.4',family:'IPv4',internal:false}]}),[],'a cloud machine behind address translation, or a computer at home');
});

test('a name typed into GODSPEED_HOST is taken however it is written, and anything else is refused',()=>{
  assert.equal(hostName('srv1328602.hstgr.cloud'),'srv1328602.hstgr.cloud');
  assert.equal(hostName(' https://Notebook.Example.com/dashboard '),'notebook.example.com');
  assert.equal(hostName('notebook.example.com.'),'notebook.example.com');
  for(const bad of ['','localhost','srv1328602','not a name.com','-bad.example.com','x'.repeat(64)+'.example.com','notebook.example.com:443'])assert.equal(hostName(bad),null,bad);
});

test('names are asked of public DNS and the system\'s upstream servers, never of the stub on this machine',()=>{
  const files={'/run/systemd/resolve/resolv.conf':'# upstream\nnameserver 153.92.2.6\nnameserver 8.8.8.8\nnameserver fe80::1%eth0\n','/etc/resolv.conf':'nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n'};
  assert.deepEqual(dnsServers(file=>{if(!(file in files))throw Error('missing');return files[file];}),['1.1.1.1','8.8.8.8','153.92.2.6']);
  assert.deepEqual(dnsServers(()=>{throw Error('missing');}),['1.1.1.1','8.8.8.8']);
});

test('the server name is the one public DNS gives this server\'s own address',async()=>{
  // Hostinger: the computer's name, which /etc/hosts would have answered with 127.0.1.1.
  assert.equal(await serverName({addresses:['76.13.139.122'],names:['srv1328602.hstgr.cloud','srv1328602'],...dns({'srv1328602.hstgr.cloud':['76.13.139.122']})}),'srv1328602.hstgr.cloud');
  // Hetzner: the computer is called "ubuntu-4gb"; the address's reverse name leads to it.
  assert.equal(await serverName({addresses:['5.75.1.2'],names:['ubuntu-4gb'],...dns({'ptr:static.2.1.75.5.clients.your-server.de':['5.75.1.2'],'static.2.1.75.5.clients.your-server.de':['5.75.1.2']})}),'static.2.1.75.5.clients.your-server.de');
  // A name that points somewhere else is not this server's.
  assert.equal(await serverName({addresses:['76.13.139.122'],names:['shop.example.com'],...dns({'shop.example.com':['93.184.216.34']})}),null);
  // No public address: no name is even looked up.
  let asked=false;
  assert.equal(await serverName({addresses:[],names:['srv1.example.com'],resolve4:async()=>{asked=true;return [];},reverse:async()=>[]}),null);
  assert.equal(asked,false);
  // Names of a home network are never a web address.
  assert.equal(await serverName({addresses:['76.13.139.122'],names:['box.localdomain','box.home'],...dns({'box.localdomain':['76.13.139.122'],'box.home':['76.13.139.122']})}),null);
});
