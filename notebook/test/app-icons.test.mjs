import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// The installed app's icon (14 October 2026). On Windows the taskbar and Start
// menu show the "any" icon as it is, so a G painted on a dark square looked like
// a cut-out tile: those icons keep a transparent background. Android crops the
// "maskable" icon to its own shape, so that one stays opaque, and iPhones paint
// a transparent home-screen icon black, so apple-touch-icon.png stays opaque too.
const ui=path.resolve(import.meta.dirname,'../ui'),pub=path.join(ui,'public');

// Width, height, colour type and the top-left pixel of an 8-bit, non-interlaced PNG.
// In the first row every PNG filter leaves the first pixel's bytes as they are.
function png(file){
  const data=fs.readFileSync(file);assert.equal(data.subarray(1,4).toString(),'PNG',file);
  let offset=8,header=null,idat=[];
  while(offset<data.length){
    const length=data.readUInt32BE(offset),type=data.subarray(offset+4,offset+8).toString(),body=data.subarray(offset+8,offset+8+length);
    if(type==='IHDR')header={width:body.readUInt32BE(0),height:body.readUInt32BE(4),depth:body[8],colour:body[9],interlace:body[12]};
    if(type==='IDAT')idat.push(body);
    if(type==='IEND')break;
    offset+=12+length;
  }
  assert.equal(header.depth,8,file);assert.equal(header.interlace,0,file);
  const channels={2:3,6:4}[header.colour];assert.ok(channels,file+' is RGB or RGBA');
  const row=zlib.inflateSync(Buffer.concat(idat));
  return {...header,corner:[...row.subarray(1,1+channels)],alpha:channels===4};
}

test('the app manifest names a transparent icon for normal use and an opaque one for cropping',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(pub,'manifest.webmanifest'),'utf8'));
  for(const icon of manifest.icons){
    const file=path.join(pub,icon.src.replace(/^\//,''));assert.ok(fs.existsSync(file),icon.src+' exists');
    const image=png(file),[width,height]=icon.sizes.split('x').map(Number);
    assert.deepEqual([image.width,image.height],[width,height],icon.src+' has the size the manifest says');
    if(icon.purpose==='maskable')assert.ok(!image.alpha||image.corner[3]===255,icon.src+' is opaque');
    else{assert.ok(image.alpha,icon.src+' has transparency');assert.equal(image.corner[3],0,icon.src+' has a transparent corner');}
  }
  assert.ok(manifest.icons.some(i=>i.purpose==='maskable'),'a maskable icon is listed');
  assert.ok(!manifest.icons.some(i=>i.purpose==='maskable'&&manifest.icons.some(a=>a.purpose==='any'&&a.src===i.src)),'the maskable icon is its own file');
});

test('the page links a real favicon and keeps the opaque iPhone icon',()=>{
  const page=fs.readFileSync(path.join(ui,'index.html'),'utf8');
  for(const href of ['/favicon.ico','/favicon-96.png','/apple-touch-icon.png']){assert.ok(page.includes('href="'+href+'"'),href+' is linked');assert.ok(fs.existsSync(path.join(pub,href.slice(1))),href+' exists');}
  assert.ok(!/rel="icon"[^>]*src\/assets/.test(page),'the favicon is no longer the in-app logo file');
  assert.equal(fs.readFileSync(path.join(pub,'favicon.ico')).readUInt32LE(0),0x00010000,'favicon.ico is an icon file');
  assert.equal(png(path.join(pub,'favicon-96.png')).corner[3],0,'the tab icon is transparent');
  const touch=png(path.join(pub,'apple-touch-icon.png'));assert.ok(!touch.alpha||touch.corner[3]===255,'apple-touch-icon.png is opaque');
});
