import {ApiError} from './api.js';
// Retired page callbacks must never borrow the next account's session or UI memory.
export function scopeServices(services,isDisposed=()=>false){
 const generation=services.generation;
 const valid=()=>!isDisposed()&&services.generation===generation;
 const scoped=new Proxy(services,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return valid()?value:undefined;return (...args)=>{if(!valid())throw new ApiError('ACCOUNT_CHANGED','A conta foi alterada.');return value.apply(target,args);};}});
 return {services:scoped,storage:{getItem:key=>valid()?services.uiMemory.get(key)??null:null,setItem:(key,value)=>{if(valid())services.uiMemory.set(key,String(value));},removeItem:key=>{if(valid())services.uiMemory.delete(key);}}};
}
