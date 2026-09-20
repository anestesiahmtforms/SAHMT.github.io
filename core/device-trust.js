export const TRUSTED_DEVICE_DAYS=180;
const INSTALLATION='sahmt:installation:v4';
export class DeviceTrust {
  constructor({storage,version,now=()=>Date.now(),uuid=()=>crypto.randomUUID()}){
    Object.assign(this,{storage,version,now});this.records=new Map();
    try{this.deviceId=storage.getItem(INSTALLATION);}catch{}
    if(!/^[a-f0-9-]{36}$/i.test(this.deviceId||'')){this.deviceId=uuid();try{storage.setItem(INSTALLATION,this.deviceId);}catch{}}
  }
  key(uid){return 'sahmt:trust:v4:'+uid;}
  read(identity){let r=this.records.get(identity.uid);if(!r)try{r=JSON.parse(this.storage.getItem(this.key(identity.uid))||'null');}catch{}
    if(r?.uid!==identity.uid||r?.deviceId!==this.deviceId)return null;return r;
  }
  inspect(identity,offline){const r=this.read(identity);const valid=Number(r?.trustedUntil)>this.now();return {deviceId:this.deviceId,trustedAt:Number(r?.trustedAt)||0,trustedUntil:Number(r?.trustedUntil)||0,trustStatus:valid?'TRUSTED':offline?'TRUST_RENEWAL_PENDING':'RENEWAL_DUE'};}
  confirm(identity){const old=this.read(identity),now=this.now(),renew=!old||Number(old.trustedUntil)<=now;
    const r={deviceId:this.deviceId,uid:identity.uid,email:identity.email||'',trustedAt:renew?now:old.trustedAt,trustedUntil:renew?now+TRUSTED_DEVICE_DAYS*86400000:old.trustedUntil,lastSeenAt:now,appVersion:this.version};
    this.records.set(identity.uid,r);try{this.storage.setItem(this.key(identity.uid),JSON.stringify(r));}catch{}
    return {...this.inspect(identity,false),trustStatus:'TRUSTED'};
  }
}
