/* SkySignal notes: explicit one-shot native/browser location and validated model weather. */
(function(){
 'use strict';
 const descriptions={0:'晴朗',1:'大致晴朗',2:'局部多雲',3:'陰天',45:'霧',48:'霧',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',56:'凍毛毛雨',57:'凍毛毛雨',61:'雨',63:'雨',65:'雨',66:'凍雨',67:'凍雨',71:'雪',73:'雪',75:'雪',77:'雪',80:'驟雨',81:'驟雨',82:'驟雨',85:'驟雪',86:'驟雪',95:'雷暴',96:'雷暴伴冰雹',99:'雷暴伴冰雹'};
 const host=()=>window.parent!==window?window.parent.CalendarNotesBridge:null;
 const cancelled=()=>Error('已取消查詢');
 function distance(a,b,c,d){const r=Math.PI/180,x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(x)));}
 function parse(raw,lat,lon,now=Date.now()){
  const c=raw?.current,u=raw?.current_units;
  if(!c||u?.temperature_2m!=='°C'||u?.time!=='unixtime'||typeof c.time!=='number'||typeof c.temperature_2m!=='number'||!Number.isFinite(c.temperature_2m)||c.temperature_2m< -90||c.temperature_2m>65||!Number.isInteger(c.weather_code)||!Object.prototype.hasOwnProperty.call(descriptions,c.weather_code))throw Error('天氣資料不完整，請改用手動輸入。');
  if(!Number.isFinite(raw.latitude)||!Number.isFinite(raw.longitude)||distance(lat,lon,raw.latitude,raw.longitude)>150000)throw Error('天氣網格與定位不符，請重試。');
  const at=c.time*1000;if(!Number.isFinite(at)||now-at>3*3600000||at-now>3600000)throw Error('天氣資料已過期，請稍後重試或手動輸入。');
  return {source:'skysignal',provider:'Open-Meteo',kind:'modelEstimate',description:descriptions[c.weather_code],temperature:c.temperature_2m,weatherCode:c.weather_code,observedAt:new Date(at).toISOString(),retrievedAt:new Date(now).toISOString(),location:`目前位置 ${lat.toFixed(3)}, ${lon.toFixed(3)}`,latitude:Number(lat.toFixed(3)),longitude:Number(lon.toFixed(3)),accuracy:null};
 }
 function browserPosition(signal){return new Promise((resolve,reject)=>{
  if(!window.isSecureContext||!navigator.geolocation)return reject(Error('目前環境無法定位，請使用 HTTPS 網站或手動輸入。'));
  if(signal?.aborted)return reject(cancelled());
  let settled=false;const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort)},finish=(fn,value)=>{if(settled)return;settled=true;cleanup();fn(value)},abort=()=>finish(reject,cancelled());
  const timer=setTimeout(()=>finish(reject,Error('定位逾時，請確認手機位置服務已開啟，或改用手動輸入。')),25000);signal?.addEventListener('abort',abort,{once:true});
  navigator.geolocation.getCurrentPosition(p=>finish(resolve,{latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp,provider:'browser'}),e=>finish(reject,Error(e.code===1?'定位權限被拒絕，可以改用手動輸入。':e.code===3?'定位逾時，請確認位置服務已開啟，或改用手動輸入。':'無法取得位置，請確認系統位置服務及網路，或手動輸入。')),{enableHighAccuracy:true,timeout:22000,maximumAge:60000});
 })}
 async function position(signal){const bridge=host();if(bridge?.nativeLocationAvailable?.()){
  if(signal?.aborted)throw cancelled();const requestId=globalThis.crypto?.randomUUID?.()||'location-'+Date.now(),abort=()=>bridge.cancelLocation(requestId);signal?.addEventListener('abort',abort,{once:true});
  try{const p=await bridge.locate(requestId);if(signal?.aborted)throw cancelled();return p}
  catch(e){if(signal?.aborted)throw cancelled();if(e.code!=='UNIMPLEMENTED'&&!/not implemented|not available|unimplemented/i.test(e.message||''))throw Error(e.message||'原生定位未能完成，請手動輸入。')}
  finally{signal?.removeEventListener('abort',abort)}
 }return browserPosition(signal)}
 async function query(url,signal){const c=new AbortController(),abort=()=>c.abort(),timer=setTimeout(abort,12000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)c.abort();try{const r=await fetch(url,{signal:c.signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});if(!r.ok)throw Error('天氣服務回應 '+r.status);return await r.json()}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}}
 async function locateAndFetch({signal,onProgress=()=>{}}={}){
  onProgress('正在取得手機位置…');const p=await position(signal);if(signal?.aborted)throw cancelled();
  const lat=p.latitude,lon=p.longitude;if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('定位資料無效，請重試。');
  onProgress('已取得位置，正在查詢當地天氣…');const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:lat.toFixed(3),longitude:lon.toFixed(3),current:'temperature_2m,weather_code',temperature_unit:'celsius',timeformat:'unixtime',timezone:'auto',forecast_days:'1'});
  let raw,transport='direct';try{raw=await query(url,signal)}catch(e){
   if(signal?.aborted)throw cancelled();const proxy=host()?.weatherProxy?.();if(!proxy||!/^https:\/\//.test(proxy))throw Error('已取得位置，但天氣連線失敗，請檢查網路或改用手動輸入。');
   onProgress('直接連線未成功，正在透過日曆天氣服務重試…');const relay=new URL(proxy);relay.search=new URLSearchParams({latitude:lat.toFixed(3),longitude:lon.toFixed(3)});
   try{raw=await query(relay,signal);transport='relay'}catch{if(signal?.aborted)throw cancelled();throw Error('已取得位置，但兩條天氣連線都未成功。可以稍後重試，或手動輸入。')}
  }
  if(signal?.aborted)throw cancelled();const result=parse(raw,lat,lon);result.accuracy=Number.isFinite(p.accuracy)?Math.round(p.accuracy):null;result.locationProvider=p.provider||'native';result.approximate=!!p.approximate;result.transport=transport;onProgress('天氣已取得，請確認後加入記錄');return result;
 }
 window.SkySignalNotes=Object.freeze({locateAndFetch,parse,description:code=>descriptions[code]||''});
})();
