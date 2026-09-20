const initial=()=>({initialized:false,authenticated:false,status:'initializing',uid:'',email:'',displayName:'',roles:[],permissions:{},memberStatus:'PENDING',deviceId:'',trustedAt:0,trustedUntil:0,offline:false,user:null,error:''});
// One public contract for every page. Keep the legacy name alias; never expose SDK credentials.
export function publicAuthState(s){return structuredClone({initialized:s.initialized,authenticated:s.authenticated,status:s.status,
 uid:s.uid,email:s.email,displayName:s.displayName,name:s.displayName,sigla:s.user?.sigla||'',roles:s.roles,permissions:s.permissions,
 memberStatus:s.memberStatus,deviceId:s.deviceId,trustedAt:s.trustedAt,trustedUntil:s.trustedUntil,trustStatus:s.trustStatus||'',offline:s.offline});}
export class AuthStore {
  constructor(){this.state=initial();this.listeners=new Set();}
  snapshot(){return structuredClone(this.state);}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  update(patch){this.state={...this.state,...patch};for(const fn of this.listeners)fn(this.snapshot());}
  reset(patch={}){this.state=initial();this.update(patch);}
}
