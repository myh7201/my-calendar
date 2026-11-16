(function(){
 'use strict';let current=null;
 window.addEventListener('calendarAccountChanged',()=>{current?.remove();current=null;});
 window.reviewGitHubConflict=function(op,payload,resolve){
  if(current||window.__widgetBackgroundSync)return;
  const uid=window.currentUser?.uid,dialog=document.createElement('dialog');current=dialog;
  dialog.style.cssText='border:0;border-radius:20px;padding:24px;width:min(90vw,460px);max-height:85vh;overflow:auto;background:var(--ai-bg,#fff);color:var(--ai-text,#17202b)';
  const title=document.createElement('h2');title.textContent='處理同步衝突';dialog.append(title);
  const message=document.createElement('p');message.textContent='其他裝置修改了同一項目。本機內容仍保留，請選擇如何處理。';dialog.append(message);
  for(const[label,item]of [['本機',op.data],['雲端',payload.documents?.[op.collection+'/'+op.id]]]){const p=document.createElement('p');p.textContent=label+'：'+(item?.title||item?.content?.slice(0,150)||(item?'設定資料':'已刪除'));dialog.append(p);}
  const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:12px;margin-top:20px';dialog.append(row);
  for(const[label,choice]of [['使用雲端版本','remote'],[op.remove?'繼續刪除':(['events','tasks','notes'].includes(op.collection)?'另存本機副本':'使用本機設定'),'local'],['稍後處理',null]]){const b=document.createElement('button');b.textContent=label;b.style.cssText='padding:10px;border:1px solid #cbd5e1;border-radius:10px';b.onclick=async()=>{if(window.currentUser?.uid!==uid)return;try{if(choice)await resolve(choice);dialog.close();dialog.remove();current=null;}catch(e){message.textContent=e.message;}};row.append(b);}
  dialog.addEventListener('cancel',()=>{current=null;dialog.remove();});document.body.append(dialog);dialog.showModal();
 };
})();
