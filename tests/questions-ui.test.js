import test from 'node:test';
import assert from 'node:assert/strict';
import {setupQuestions} from '../public/questions-ui.js';

class Element {
  constructor(){this.value='';this.checked=false;this.children=[];this.listeners={};}
  addEventListener(name,fn){this.listeners[name]=fn;}
  replaceChildren(...values){this.children=values;}
  append(...values){this.children.push(...values);}
  removeAttribute(name){delete this[name];}
  scrollIntoView(){}
}
function fixture(t,cloud){
  const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const before=globalThis.document, previousLocation=globalThis.location;
  globalThis.document={getElementById:get,createElement:()=>new Element()};globalThis.location={hash:'#bank'};
  t.after(()=>{globalThis.document=before;globalThis.location=previousLocation;});
  const ui=setupQuestions({cloud,request:()=>assert.fail('no local request'),act:fn=>fn(),message(){},showError:assert.fail,getState:()=>({mode:'hosted'})});
  return {get,ui};
}
test('a late list response cannot repopulate private results after the account changes',async t=>{
  let finish;const cloud={enabled:true,ready:true,user:{id:'a'},list:()=>new Promise(resolve=>{finish=resolve;})};
  const {ui,get}=fixture(t,cloud), loading=ui.enter('bank');
  ui.reset();cloud.user={id:'b'};
  finish([{id:'private-a',question:'private account A question',source:'private source',status:'uploaded'}]);await loading;
  get('bank-search').listeners.input();
  assert.equal(get('question-list').children.some(child=>child.children.some(value=>value.textContent?.includes('private account A'))),false);
  assert.equal(get('original-count').textContent,'0');
});
test('a late signed image URL cannot restore the original photo after logout',async t=>{
  let finish, started;const waiting=new Promise(resolve=>{started=resolve;});
  const row={id:'private-a',ownerId:'a',imageReady:true,question:'test',status:'uploaded',source:'public fixture',date:'2026-10-07',filename:'test.png'};
  const cloud={enabled:true,ready:true,user:{id:'a'},list:async()=>[row],get:async()=>row,imageUrl:()=>{started();return new Promise(resolve=>{finish=resolve;});}};
  const {ui,get}=fixture(t,cloud);await ui.enter('bank');
  const opening=get('question-list').children[0].listeners.click();await waiting;
  ui.reset();cloud.user=null;cloud.enabled=false;finish('https://example.invalid/private-signed-photo');await opening;
  assert.equal(get('original-image').src,undefined);assert.equal(get('original-image-link').href,undefined);
  assert.equal(get('question-review').hidden,true);assert.equal(get('review-question').value,'');
});
