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
function fixture(t,mode){
  const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const before=globalThis.document;
  globalThis.document={getElementById:get,createElement:()=>new Element()};t.after(()=>{globalThis.document=before;});
  const ui=setupQuestions({request:()=>assert.fail('no mutation'),act:fn=>fn(),message(){},showError:assert.fail,getState:()=>({mode})});
  return {get,ui};
}
test('a late local list response cannot restore records after the view is reset',async t=>{
  let finish;t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{finish=resolve;}));
  const {ui,get}=fixture(t,'local'),loading=ui.enter('bank');ui.reset();
  finish(Response.json({questions:[{id:'a',question:'private question',source:'fixture',status:'uploaded'}]}));await loading;
  get('bank-search').listeners.input();
  assert.equal(get('question-list').children.some(child=>child.children.some(value=>value.textContent?.includes('private question'))),false);
  assert.equal(get('original-count').textContent,'0');
});
test('the hosted preview does not request local records or enable uploading',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('preview must not request records'));
  const {ui,get}=fixture(t,'hosted');await ui.enter('bank');ui.render();
  assert.equal(get('upload-form').hidden,true);assert.equal(get('upload-cloud-note').hidden,false);
  assert.match(get('bank-empty-note').textContent,/Windows/);
});