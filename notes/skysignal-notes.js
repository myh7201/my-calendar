/* SkySignal notes adapter. WMO descriptions ported from SkySignal v65 ModelForecast.java.
 * Uses the same Open-Meteo provider with explicit geolocation and preview before saving.
 * No location watcher, background requests or automatic note writes.
 */
(function(){
 'use strict';
 const descriptions={0:'晴朗',1:'大致晴朗',2:'局部多雲',3:'陰天',45:'霧',48:'霧',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',56:'凍毛毛雨',57:'凍毛毛雨',61:'雨',63:'雨',65:'雨',66:'凍雨',67:'凍雨',71:'雪',73:'雪',75:'雪',77:'雪',80:'驟雨',81:'驟雨',82:'驟雨',85:'驟雪',86:'驟雪',95:'雷暴',96:'雷暴伴冰雹',99:'雷暴伴冰雹'};
 function distance(a,b,c,d){const r=Math.PI/180,x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(x)));}
 function parse(raw,lat,lon,now=Date.now()){
  const c=raw?.current,u=raw?.current_units;
  if(!c||u?.temperature_2m!=='°C'||u?.time!=='unixtime'||typeof c.time!=='number'||typeof c.temperature_2m!=='number'||!Number.isFinite(c.temperature_2m)||c.temperature_2m< -90||c.temperature_2m>65||!Number.isInteger(c.weather_code)||!Object.hasOwn(descriptions,c.weather_code))throw Error('天氣資料不完整，請改用手動輸入。');
  if(!Number.isFinite(raw.latitude)||!Number.isFinite(raw.longitude)||distance(lat,lon,raw.latitude,raw.longitude)>150000)throw Error('天氣網格與定位不符，請重試。');
  const at=c.time*1000;if(!Number.isFinite(at)||now-at>3*3600000||at-now>3600000)throw Error('天氣資料已過期，請稍後再試或手動輸入。');
  return {source:'skysignal',provider:'Open-Meteo',kind:'modelEstimate',description:descriptions[c.weather_code],temperature:c.temperature_2m,weatherCode:c.weather_code,observedAt:new Date(at).toISOString(),retrievedAt:new Date(now).toISOString(),location:`定位地點 ${lat.toFixed(3)}, ${lon.toFixed(3)}`,latitude:Number(lat.toFixed(3)),longitude:Number(lon.toFixed(3)),accuracy:null};
 }
 async function locateAndFetch({signal}={}){
  if(!isSecureContext||!navigator.geolocation)throw Error('目前環境無法定位，請使用 HTTPS 網站或手動輸入。');
  const p=await new Promise((resolve,reject)=>{
   if(signal?.aborted)return reject(Error('已取消'));
   const cancel=()=>reject(Error('已取消'));signal?.addEventListener('abort',cancel,{once:true});
   navigator.geolocation.getCurrentPosition(value=>{signal?.removeEventListener('abort',cancel);resolve(value)},error=>{signal?.removeEventListener('abort',cancel);reject(Error(error.code===1?'定位權限被拒絕，可以改用手動輸入。':error.code===3?'定位逾時，請重試或手動輸入。':'暫時無法取得位置，請改用手動輸入。'))},{enableHighAccuracy:false,timeout:15000,maximumAge:60000});
  });
  if(signal?.aborted)throw Error('已取消');
  const lat=p.coords.latitude,lon=p.coords.longitude;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('定位資料無效。');
  const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,15000);signal?.addEventListener('abort',cancel,{once:true});
  try{
   const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:lat,longitude:lon,current:'temperature_2m,weather_code',temperature_unit:'celsius',timeformat:'unixtime',timezone:'auto',forecast_days:'1'});
   const response=await fetch(url,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
   if(!response.ok)throw Error('天氣服務暫時無法使用，請改用手動輸入。');
   const result=parse(await response.json(),lat,lon);result.accuracy=Number.isFinite(p.coords.accuracy)?Math.round(p.coords.accuracy):null;return result;
  }catch(e){if(e.name==='AbortError')throw Error(signal?.aborted?'已取消':'天氣服務逾時，請重試或手動輸入。');throw e}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
 }
 window.SkySignalNotes=Object.freeze({locateAndFetch,parse,description:code=>descriptions[code]||''});
})();
