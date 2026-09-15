/* Reusable cast selection. References are assigned without enabling spending. */
'use strict';
const castPanel=document.createElement('section');
castPanel.className='cast-panel';
castPanel.innerHTML='<h3>Your cast</h3><p class="small muted">Choose characters once. We use their reference images throughout the story. Finished scripts can include cast_ids for precise casting.</p><div class="row"><button type="button" class="btn sm" id="cast-load">Choose from library</button><button type="button" class="btn sm" id="cast-pack">Add original horror cast</button><button type="button" class="btn sm" id="cast-upload">Upload a character</button></div><p id="cast-status" class="small muted" role="status"></p><div id="cast-options"></div><label class="f" for="cast-default">When a shot does not name a character</label><select id="cast-default"><option value="">Scenery / no default character</option></select><p class="small muted">New scenes require paid visuals and a fal connection. Uploaded finished scenes can be locked and used directly.</p>';
$('#mode-note').after(castPanel);
const castStyle=document.createElement('style');castStyle.textContent='.cast-panel{margin:18px 0;padding:18px;border:1px solid #343744;border-radius:16px;background:#171923}.cast-panel h3{margin:0 0 8px}.cast-option{display:grid;grid-template-columns:22px 54px 1fr;gap:12px;align-items:start;padding:12px 0;border-bottom:1px solid #343744}.cast-option img{width:54px;height:76px;object-fit:cover;border-radius:8px}.cast-option input[type=checkbox]{width:20px;margin-top:8px}.cast-option textarea{margin-top:8px;min-height:58px}.cast-shot{margin:12px 0;padding:12px;border:1px solid #343744;border-radius:10px}.cast-shot .check{display:inline-flex;margin-right:14px}';document.head.append(castStyle);
function currentCast(){return draft||store.get('creative',{});}
function saveCast(cast,defaultId){
  const prefs=store.get('creative',{});prefs.cast=cast;prefs.cast_default_id=defaultId;store.set('creative',prefs);
  if(draft){draft.cast=cast;draft.cast_default_id=defaultId;StudioCore.applyCast(draft);store.set('draft',draft);}
}
function renderCast(){
  const config=currentCast(),chosen=config.cast||[],box=$('#cast-options');revokeMedia(box);box.replaceChildren();
  const available=[...new Map([...chosen.map(c=>({id:c.id,title:c.name,kind:'image'})),...library.filter(a=>a.kind==='image')].map(a=>[a.id,a])).values()];
  for(const asset of available){
    const member=chosen.find(c=>c.id===asset.id),row=document.createElement('div');row.className='cast-option';
    const check=document.createElement('input');check.type='checkbox';check.checked=!!member;check.setAttribute('aria-label','Use '+asset.title);
    const picture=mediaElement(asset);const body=document.createElement('div');
    const name=document.createElement('input');name.value=member?.name||asset.character_name||asset.title;name.setAttribute('aria-label','Character name');
    const desc=document.createElement('textarea');desc.rows=2;desc.value=member?.description||asset.character_description||'';desc.placeholder='Appearance to preserve: hair, clothes, colors, props…';desc.setAttribute('aria-label','Character appearance');
    function update(){const state=currentCast();let cast=(state.cast||[]).filter(c=>c.id!==asset.id);if(check.checked)cast.push({id:asset.id,name:name.value.trim()||asset.title,description:desc.value.trim(),aliases:member?.aliases||asset.aliases||[]});let lead=state.cast_default_id||'';if(!cast.some(c=>c.id===lead))lead='';saveCast(cast,lead);renderCast();}
    check.onchange=update;name.onchange=update;desc.onchange=update;body.append(name,desc);row.append(check,picture,body);box.append(row);
  }
  const lead=$('#cast-default');lead.replaceChildren(new Option('Scenery / no default character',''));for(const c of chosen)lead.add(new Option(c.name,c.id));lead.value=config.cast_default_id||'';
  $('#cast-status').textContent=chosen.length?`${chosen.length} character${chosen.length===1?'':'s'} selected. Choose a default for first-person stories.`:'Choose images from your library, upload your own, or add the original horror cast.';
  castPanel.hidden=$('#production-mode').value==='stock'&&!chosen.length;
}
$('#cast-default').onchange=e=>saveCast(currentCast().cast||[],e.target.value);
$('#production-mode').addEventListener('change',renderCast);
$('#cast-load').onclick=async()=>{await loadLibrary();renderCast();};
const referenceLabel=document.createElement('label');referenceLabel.className='check';referenceLabel.innerHTML='<input type="checkbox" id="asset-reference-only"> Character reference only — keep this sheet out of finished footage';$('#asset-kind').after(referenceLabel);
$('#cast-upload').onclick=()=>{openAsset();$('#asset-kind').value='image';$('#asset-reference-only').checked=true;};
function syncImportedCreative(){
  if(draft){for(const [key,id] of Object.entries(creativeFields))if(draft[key]!==undefined)$(id).value=draft[key];$('#ai-enabled').checked=draft.ai?.enabled===true;$('#ai-budget').value=draft.ai?.budget||0;$('#mode-note').textContent=modeNotes[draft.production_mode]||modeNotes.stock;}
  renderCast();
}
document.addEventListener('studio:draft',syncImportedCreative);
$('#btn-discard').addEventListener('click',renderCast);
const libraryObserver=new MutationObserver(()=>renderCast());libraryObserver.observe($('#library-grid'),{childList:true});
$('#cast-pack').onclick=async()=>{
  const button=$('#cast-pack');button.disabled=true;
  try{
    if(!configured())throw new Error('Connect your pipeline in Settings first.');
    const response=await fetch('assets/horror-cast/manifest.json');if(!response.ok)throw new Error('The character pack is unavailable. Push the new Hub assets and refresh.');
    const pack=await response.json();library=(await mediaJSON('library/index.json',{assets:[]})).assets||[];
    for(const entry of pack.assets){
      if(library.some(a=>a.id===entry.id))continue;
      $('#cast-status').textContent='Adding '+entry.character_name+'…';
      const download=await fetch('assets/horror-cast/'+entry.file);if(!download.ok)throw new Error('Could not load '+entry.file);
      const file=new File([await download.blob()],entry.file,{type:'image/png'});
      const {file:filename,...metadata}=entry;const asset={...metadata,...await uploadAsset(file)};
      await saveLibraryAsset(asset);library.push(asset);
    }
    await loadLibrary();renderCast();toast('Original horror cast added. Select the characters for this story.');
  }catch(e){$('#cast-status').textContent=e.message;}finally{button.disabled=false;}
};
window.addCastShotControls=(card,beat,scene)=>{
  const cast=draft.cast||[];if(!cast.length||draft.production_mode==='stock')return;
  const box=document.createElement('div');box.className='cast-shot';
  const heading=document.createElement('b');heading.textContent='Characters in this shot';box.append(heading);
  const auto=document.createElement('button');auto.type='button';auto.className='btn sm';auto.textContent='Use automatic casting';auto.onclick=()=>{delete beat.cast_ids;store.set('draft',draft);renderShots();};box.append(auto,document.createElement('br'));
  const explicit=beat.cast_ids??scene.cast_ids;const selected=Array.isArray(explicit)?explicit:cast.filter(c=>c.id===beat.reference_id).map(c=>c.id);
  for(const c of cast){const label=document.createElement('label');label.className='check';const input=document.createElement('input');input.type='checkbox';input.value=c.id;input.checked=selected.includes(c.id);input.onchange=()=>{beat.cast_ids=$$('input:checked',box).map(x=>x.value);store.set('draft',draft);renderShots();};label.append(input,document.createTextNode(c.name));box.append(label);}
  const note=document.createElement('p');note.className='small muted';note.textContent=beat.locked?'Locked finished artwork is kept. Unlock to generate a new scene.':(draft.cast_errors||[]).find(e=>e.startsWith(beat.id+':'))||'Uncheck all characters for scenery. Multiple characters need a combined reference under Shot direction.';box.append(note);
  card.insertBefore(box,$('details',card));
};
syncImportedCreative();
