import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {Resolver} from 'node:dns/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The name a server is reached by from the internet, for the web address the Linux
// installer gives it (install-native-notebook.sh). A server here is a computer with a
// public IPv4 address on one of its own network interfaces, as a rented VPS has and a
// computer at home does not, and a name that public DNS gives that same address. The
// name is asked of public DNS servers, never of /etc/hosts or the system's own resolver:
// Ubuntu lists the computer's own name there as 127.0.1.1, and systemd-resolved (the
// 127.0.0.53 in /etc/resolv.conf) answers from that list, so on 7 October 2026 the
// ordinary lookup found the production server at home on itself.

const notPublic=new net.BlockList();
for(const [address,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]])notPublic.addSubnet(address,bits,'ipv4');
export const publicIPv4=address=>net.isIPv4(address)&&!notPublic.check(address,'ipv4');

export function publicAddresses(interfaces=os.networkInterfaces()){
  return [...new Set(Object.values(interfaces).flat().filter(a=>a&&(a.family==='IPv4'||a.family===4)&&!a.internal&&publicIPv4(a.address)).map(a=>a.address))];
}

// A name as someone types it into GODSPEED_HOST: "https://notebook.example/" is
// notebook.example. Anything that is not a DNS name with at least one dot is null.
export function hostName(value){
  const text=String(value||'').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i,'').replace(/[/?#].*$/,'').replace(/\.$/,'').toLowerCase();
  return /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(text)?text:null;
}

// Two public DNS services, then the servers the system's resolver itself asks (systemd
// keeps those in /run/systemd/resolve/resolv.conf), for a network that blocks the public
// ones. A server on this machine (127.x) is never asked.
export function dnsServers(read=file=>fs.readFileSync(file,'utf8')){
  const servers=['1.1.1.1','8.8.8.8'];
  for(const file of ['/run/systemd/resolve/resolv.conf','/etc/resolv.conf']){
    let text='';try{text=read(file);}catch{}
    for(const [,server] of text.matchAll(/^\s*nameserver\s+(\S+)/gm))if(net.isIP(server)&&!server.includes('%')&&!/^127\./.test(server)&&server!=='::1'&&!servers.includes(server))servers.push(server);
  }
  return servers;
}

function localNames(){
  const names=[];
  try{names.push(execFileSync('hostname',['-f'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000}).trim());}catch{}
  names.push(os.hostname());
  return names;
}

// The computer's own names first, then the names its public addresses have in reverse DNS
// (a Hetzner server is static.<address>.clients.your-server.de there); the first one whose
// public DNS answer is one of this computer's public addresses.
export async function serverName({addresses=publicAddresses(),names,resolve4,reverse}={}){
  if(!addresses.length)return null;
  const resolver=new Resolver({timeout:3000,tries:2});resolver.setServers(dnsServers());
  resolve4||=name=>resolver.resolve4(name);
  reverse||=address=>resolver.reverse(address);
  const candidates=[...(names||localNames())];
  for(const address of addresses)candidates.push(...await reverse(address).catch(()=>[]));
  const tried=new Set();
  for(const candidate of candidates){
    const name=hostName(candidate);
    if(!name||tried.has(name)||/(^|\.)(localhost|localdomain|local|internal|lan|home)$/.test(name))continue;
    tried.add(name);
    if((await resolve4(name).catch(()=>[])).some(address=>addresses.includes(address)))return name;
  }
  return null;
}

// node server-address.mjs             prints this server's name, or nothing
// node server-address.mjs --name <x>  prints <x> as a name, or fails when it is not one
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='--name'){
    const name=hostName(process.argv[3]);
    if(!name)process.exit(1);
    process.stdout.write(name);
  }else{
    const name=await serverName();
    if(name)process.stdout.write(name);
  }
}
