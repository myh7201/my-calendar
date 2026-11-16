(function(){
 'use strict';let frame=null,bridge=null,lastCalendarView='month';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const text=html=>{const el=document.createElement('div');el.innerHTML=html;el.querySelectorAll('script,style,iframe,object,embed').forEach(x=>x.remove());el.querySelectorAll('p,div,br,h1,h2,h3,li').forEach(x=>x.append('\n'));return el.textContent||'';};
 function createBridge(){
  const owner=window.currentUser?.uid||null,generation=window.__calendarAccountGeneration;
  const assert=()=>{if((window.currentUser?.uid||null)!==owner||window.__calendarAccountGeneration!==generation)throw Error('帳號已切換，這份筆記不能寫入新帳號');};
  const versionsFor=new WeakMap();
  const prefKey='calendar_notes_preferences_v45:'+encodeURIComponent(owner||'guest');
  return {scope:owner||'guest',
   nativeLocationAvailable(){assert();return !!window.Capacitor?.isNativePlatform?.();},
   async locate(requestId){assert();const cap=window.Capacitor;if(!cap?.isNativePlatform?.())throw Error('Native location unavailable');const plugin=cap.Plugins?.NotesLocation||cap.registerPlugin('NotesLocation');const result=await plugin.getCurrent({requestId,timeout:22000});assert();return result;},
   async cancelLocation(requestId){try{const cap=window.Capacitor;if(cap?.isNativePlatform?.()){const plugin=cap.Plugins?.NotesLocation||cap.registerPlugin('NotesLocation');await plugin.cancel({requestId});}}catch{}},
   weatherProxy(){assert();return String(window.CALENDAR_ASSISTANT_CONFIG?.apiBase||'').replace(/\/$/,'')+'/api/public-weather';},
   syncStatus(id){assert();const data=window.CalendarData;return {authenticated:!!window.currentUser,online:navigator.onLine,ready:!!window.__widgetCloudReady,pending:id?!!data?.hasPending('notes',id):!!data?.pending('notes'),error:!!data?.error};},
   subscribeSync(listener){const update=()=>{try{assert();listener();}catch{}};for(const name of ['calendarSyncStatus','calendarNotesCloudChanged','online','offline'])window.addEventListener(name,update);return ()=>{for(const name of ['calendarSyncStatus','online','offline'])window.removeEventListener(name,update);};},
   countCharacters:value=>window.noteCharacterCount(value),
   async readNotes(){assert();const raw=structuredClone(window.state.notes||[]),versions=await window.GitHubCalendar?.noteVersions?.()||{};const hashes=Object.fromEntries(await Promise.all(Object.entries(versions).map(async([p,v])=>{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)));return [p,Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')];})));const expanded=await window.CalendarMedia.expandNotes(raw);assert();const result=expanded.map(n=>({...structuredClone(n.richNote||{}),id:String(n.id),kind:n.type==='diary'?'diary':'note',title:n.title||'',html:n.richNote?.html??('<p>'+esc(n.content||'').replaceAll('\n','<br>')+'</p>'),folder:n.folder||'',created:n.createdAt||n.richNote?.created||Date.now(),updated:n.updatedAt||n.richNote?.updated||n.createdAt||Date.now(),tags:n.richNote?.tags||[],date:n.richNote?.date||new Date(n.createdAt||Date.now()).toLocaleDateString('sv-SE'),history:n.richNote?.history||[]}));versionsFor.set(result,hashes);return result;},
   confirmLoaded(notes){assert();window.GitHubCalendar?.acceptNoteVersions?.(versionsFor.get(notes)||{});},
   readPreferences(){assert();try{const synced=window.getNotesPreferences?.();const value=localStorage.getItem(prefKey);return synced|| (value?JSON.parse(value):{folders:[...new Set([...(window.state.noteFolders||[]),...(window.state.diaryFolders||[])])],settings:{}});}catch{return {folders:[],settings:{}};}},
   async writePreferences(value){assert();localStorage.setItem(prefKey,JSON.stringify(value));window.state.noteFolders=[...new Set(value.folders||[])];window.state.diaryFolders=[...new Set(value.folders||[])];window.saveFolders?.();await window.saveNotesPreferences?.(value);},
   async writeNote(note){assert();const plain=text(note.html||'');const richNoteRef=await window.CalendarMedia.pack(note);assert();const index=window.state.notes.findIndex(n=>String(n.id)===String(note.id)),old=index>=0?window.state.notes[index]:{};const item={...old,id:String(note.id),type:note.kind==='diary'?'diary':'note',title:note.title||'',content:plain.slice(0,4000),folder:note.folder||'',createdAt:old.createdAt||note.created||Date.now(),updatedAt:note.updated||Date.now(),richNoteRef,trashed:!!note.deleted};delete item.richNote;if(index>=0)window.state.notes[index]=item;else window.state.notes.push(item);await window.saveNotes();},
   removeNote(id){assert();window.state.notes=window.state.notes.filter(n=>String(n.id)!==String(id));window.saveNotes();},
   returnToCalendar(){assert();window.state.view=lastCalendarView;window.renderAll();}
  };
 }
 window.flushCalendarNotes=()=>frame?.contentWindow?.CalendarNotes?.flush()||Promise.resolve(true);
 window.mountCalendarNotes=function(){const container=document.getElementById('calendarViewContainer');if(frame?.isConnected)return;bridge=createBridge();window.CalendarNotesBridge=bridge;frame=document.createElement('iframe');frame.id='calendarNotesFrame';frame.title='筆記與日記';frame.src='./notes/index.html?v=452';frame.style.cssText='border:0;width:100%;height:100%;display:block;min-height:0;';frame.allow='microphone; geolocation';container.replaceChildren(frame);};
 window.openCalendarRichNote=function(id,createKind){window.state.view='notes';window.renderAll();if(!id&&!createKind)return;const open=()=>Promise.resolve(id?frame?.contentWindow?.CalendarNotes?.open(String(id)):frame?.contentWindow?.CalendarNotes?.create(createKind)).catch(e=>window.showToast?.(e.message));if(frame?.contentWindow?.CalendarNotes)open();else frame?.addEventListener('load',open,{once:true});};
 window.addEventListener('calendarAccountChanged',()=>{frame?.remove();frame=null;bridge=null;window.CalendarNotesBridge=null;});
 let leaving=false;
 const install=()=>{if(typeof window.renderAll!=='function')return;const original=window.renderAll;window.renderAll=function(...args){
  if(window.state.view==='notes'){document.body.classList.add('calendar-notes-active');return original.apply(this,args);}
  if(frame?.isConnected&&!leaving){const view=window.state.view;window.state.view='notes';leaving=true;Promise.resolve(frame.contentWindow.CalendarNotes?.destroy()).then(ok=>{leaving=false;if(ok===false)return;frame?.remove();frame=null;browserNoteEntry=false;window.CalendarNotesBridge=null;lastCalendarView=view;window.state.view=view;document.body.classList.remove('calendar-notes-active');original.apply(this,args);}).catch(()=>{leaving=false;window.showToast?.('筆記尚未儲存，請先匯出備份');});return;}
  document.body.classList.remove('calendar-notes-active');lastCalendarView=window.state.view;return original.apply(this,args);
 };};
 const calendarBack=window.handleAndroidBack;
 if(calendarBack)window.removeEventListener('androidBackPressed',calendarBack);
 window.handleAndroidBack=function(){if(window.state?.view==='notes'&&frame?.isConnected){Promise.resolve(frame.contentWindow.CalendarNotes?.back?.()).catch(()=>window.showToast?.('筆記尚未儲存，請重試'));return;}calendarBack?.();};
 window.addEventListener('androidBackPressed',window.handleAndroidBack);
 let browserNoteEntry=false;
 window.addEventListener('popstate',()=>{if(window.state?.view!=='notes'||!frame?.isConnected)return;Promise.resolve(frame.contentWindow.CalendarNotes?.back?.()).then(result=>{if(result!=='calendar'&&window.state?.view==='notes'){history.pushState({calendarNotes:true},'',location.href);browserNoteEntry=true;}}).catch(()=>{});});
 const originalMount=window.mountCalendarNotes;window.mountCalendarNotes=function(){originalMount();if(!window.Capacitor?.isNativePlatform?.()&&!browserNoteEntry){history.pushState({calendarNotes:true},'',location.href);browserNoteEntry=true;}};
 install();window.addEventListener('calendarNotesCloudChanged',()=>Promise.resolve(frame?.contentWindow?.CalendarNotes?.refresh()).catch(e=>window.showToast?.(e.message)));
})();
