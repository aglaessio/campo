/* Authentication uses the official SDK; all authorizations are enforced by RLS. */
const cloud={client:null,user:null,ready:false,admin:false,revision:0,epoch:0,dirty:false,saving:false,savingEpoch:0,conflict:false,timer:null,lastSaved:'',authMode:'login',refreshTimer:null};
const baseRender=render;
const emptyProgress=()=>({completed:[],practice:[],passed:[],notes:{},checks:[],lastLesson:0,labDone:[],labTests:{}});
const config=window.CAMPO_CONFIG;
let pendingPassword=/type=(invite|recovery)/.test(location.hash);
function saveStatus(message,error=false){$('#cloud-save-status').textContent=message;$('#cloud-save-status').classList.toggle('save-error',error);}
function cloudNotice(message,action){const el=$('#cloud-notice');el.hidden=!message;el.replaceChildren();if(message)el.append(document.createTextNode(message));if(action){const b=document.createElement('button');b.className='button secondary';b.textContent=action.label;b.onclick=action.run;el.append(b);}}
function clearContent(){[modules,lessons,references,glossary,cases].forEach(a=>a.splice(0));Object.assign(state,emptyProgress());cloud.ready=false;cloud.admin=false;cloud.revision=0;cloud.dirty=false;cloud.saving=false;cloud.conflict=false;cloud.lastSaved='';clearTimeout(cloud.timer);clearInterval(cloud.refreshTimer);}
function accountChrome(){document.body.classList.toggle('access-locked',!cloud.ready);$('#account-signout').hidden=!cloud.user;$('#breadcrumb').textContent=cloud.ready?'Minha formação':'Campo · Acesso por convite';}
function authPage(mode='login',message=''){
  cloud.authMode=mode;cloud.ready=false;accountChrome();
  const password=mode==='password',reset=mode==='reset',blocked=mode==='blocked',setup=mode==='setup';
  const title=password?'Defina sua senha':reset?'Recuperar acesso':blocked?'Acesso indisponível':setup?'Curso aguardando ativação':'Entre no seu curso';
  const description=blocked?'Sua matrícula não está ativa. Fale com o responsável pelo curso.':setup?'O responsável está concluindo a configuração do acesso.':password?'Escolha uma senha individual com pelo menos 12 caracteres.':reset?'Informe o e-mail da sua conta para receber as instruções.':'Acesso reservado aos alunos convidados.';
  $('#main').innerHTML=`<section class="auth-page"><a class="brand" href="${esc(config.siteUrl)}"><span class="brand-mark">C</span><span>CAMPO<small>ACADEMIA TÉCNICA</small></span></a><div class="eyebrow">REDES E CFTV</div><h1>${title}</h1><p>${description}</p>${blocked||setup?'':`<form class="auth-form" id="auth-form">${password?'':`<label for="auth-email">E-mail<input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254"></label>`}${reset?'':`<label for="auth-password">${password?'Nova senha':'Senha'}<input id="auth-password" name="password" type="password" autocomplete="${password?'new-password':'current-password'}" ${password?'minlength="12"':''} required></label>`}${password?'<label for="auth-password-confirm">Confirme a senha<input id="auth-password-confirm" name="confirm" type="password" minlength="12" autocomplete="new-password" required></label>':''}<button class="button" type="submit">${password?'Salvar senha':reset?'Enviar instruções':'Entrar'}</button></form><div class="auth-actions">${mode==='login'?'<button id="reset-access">Esqueci minha senha</button>':reset?'<button id="back-login">Voltar para entrar</button>':''}</div>`}<p class="auth-feedback" id="auth-feedback" role="status">${esc(message)}</p></section>`;
  $('#reset-access')?.addEventListener('click',()=>authPage('reset'));$('#back-login')?.addEventListener('click',()=>authPage());
  $('#auth-form')?.addEventListener('submit',submitAuth);
  saveStatus(cloud.user?'Conta conectada':'Acesso por convite');
}
async function submitAuth(event){
  event.preventDefault();const form=event.target,button=$('button',form),mode=cloud.authMode;button.disabled=true;$('#auth-feedback').textContent='Aguarde...';
  try{
    const data=new FormData(form);
    if(mode==='password'){
      const password=String(data.get('password'));if(password!==data.get('confirm'))throw Error('As senhas precisam ser iguais.');
      const {error}=await cloud.client.auth.updateUser({password});if(error)throw Error('Não foi possível salvar a senha. Confira os requisitos e tente novamente.');
      pendingPassword=false;history.replaceState(null,'','#inicio');await loadAccount();
    }else if(mode==='reset'){
      const {error}=await cloud.client.auth.resetPasswordForEmail(String(data.get('email')).trim(),{redirectTo:config.siteUrl});
      if(error)throw Error('Não foi possível enviar as instruções. Tente novamente mais tarde.');
      $('#auth-feedback').textContent='Se esta conta estiver cadastrada, você receberá as instruções por e-mail.';
    }else{
      const {error}=await cloud.client.auth.signInWithPassword({email:String(data.get('email')).trim(),password:String(data.get('password'))});
      if(error)throw Error('Não foi possível entrar. Confira e-mail e senha.');
      await loadAccount();
    }
  }catch(error){const feedback=$('#auth-feedback');if(feedback){feedback.classList.add('error');feedback.textContent=error.message;}}
  finally{if(button.isConnected)button.disabled=false;}
}
async function loadAccount(){
  const epoch=++cloud.epoch;clearContent();cloudNotice('');
  $('#main').innerHTML='<p>Carregando sua matrícula e seu avanço...</p>';accountChrome();
  try{
    const {data:auth,error:authError}=await cloud.client.auth.getUser();
    if(epoch!==cloud.epoch)return;if(authError||!auth?.user){cloud.user=null;authPage();return;}
    cloud.user=auth.user;accountChrome();
    if(pendingPassword){authPage('password');return;}
    const {data:member,error:memberError}=await cloud.client.from('course_memberships').select('status').eq('course_id',config.courseId).eq('user_id',cloud.user.id).maybeSingle();
    if(epoch!==cloud.epoch)return;if(memberError)throw memberError;
    if(member?.status!=='active'){authPage('blocked');return;}
    const results=await Promise.all([
      cloud.client.from('courses').select('content').eq('id',config.courseId).single(),
      cloud.client.from('course_progress').select('data,revision').eq('course_id',config.courseId).eq('user_id',cloud.user.id).maybeSingle(),
      cloud.client.from('course_admins').select('user_id').eq('course_id',config.courseId).eq('user_id',cloud.user.id).maybeSingle()
    ]);
    if(epoch!==cloud.epoch)return;for(const r of results)if(r.error)throw r.error;
    const content=results[0].data?.content;
    if(!content||content.lessons?.length!==32||content.modules?.length!==8)throw Error('Conteúdo indisponível.');
    for(const [array,key] of [[modules,'modules'],[lessons,'lessons'],[references,'references'],[glossary,'glossary'],[cases,'cases']]){if(!Array.isArray(content[key]))throw Error('Conteúdo inválido.');array.push(...content[key]);}
    const saved=results[1].data;if(saved)Object.assign(state,importState({format:'campo-course-progress',version:1,state:saved.data}));
    cloud.revision=saved?.revision||0;cloud.lastSaved=JSON.stringify(state);cloud.admin=!!results[2].data;cloud.ready=true;accountChrome();
    const target=location.hash;if(!target||target==='#inicio'||target.includes('access_token')||target.includes('type='))history.replaceState(null,'',`#aula-${state.lastLesson}`);
    render();saveStatus('Avanço salvo na nuvem');
    cloud.refreshTimer=setInterval(()=>verifyAccess(),30000);
  }catch{
    if(epoch!==cloud.epoch)return;clearContent();authPage('blocked','Não foi possível carregar o curso. Atualize a página para tentar novamente.');
  }
}
async function verifyAccess(){
  if(!cloud.ready||!cloud.user)return;
  const epoch=cloud.epoch;
  const {data,error}=await cloud.client.from('course_memberships').select('status').eq('course_id',config.courseId).eq('user_id',cloud.user.id).maybeSingle();
  if(epoch!==cloud.epoch)return;
  if(!error&&data?.status!=='active'){++cloud.epoch;clearContent();authPage('blocked','O responsável removeu seu acesso ao curso.');}
  else if(error)saveStatus('Conexão indisponível',true);
}
render=function(scroll=true){
  if(!cloud.ready)return;
  if(location.hash==='#admin'){
    if(cloud.admin){renderAdmin();return;}
    history.replaceState(null,'','#inicio');
  }
  baseRender(scroll);renderIcons();
  if($('#lesson-note'))$('#lesson-note').maxLength=4000;
  document.querySelectorAll('.study-aside p').forEach(p=>{if(p.textContent.startsWith('Salve seu avanço'))p.textContent='Seu avanço e suas anotações são salvos automaticamente na sua conta.';});
  document.querySelectorAll('.admin-button').forEach(link=>link.remove());
  if(cloud.admin){const link=document.createElement('a');link.href='#admin';link.className='button secondary admin-button';link.textContent='Gerenciar alunos';$('.sidebar-bottom').append(link);}
  scheduleSave();
};
function scheduleSave(){
  if(!cloud.ready||cloud.conflict)return;
  const snapshot=JSON.stringify(state);if(snapshot===cloud.lastSaved)return;
  cloud.dirty=true;saveStatus('Alterações aguardando salvamento');clearTimeout(cloud.timer);
  cloud.timer=setTimeout(()=>flushProgress(),800);
}
async function flushProgress(){
  if(!cloud.ready||cloud.saving||cloud.conflict||!cloud.dirty)return;
  const epoch=cloud.epoch,userId=cloud.user.id,snapshot=JSON.stringify(state);cloud.saving=true;cloud.savingEpoch=epoch;cloud.dirty=false;saveStatus('Salvando avanço...');
  try{
    const {data,error}=await cloud.client.rpc('save_course_progress',{course_key:config.courseId,expected_revision:cloud.revision,progress_data:JSON.parse(snapshot)});
    if(epoch!==cloud.epoch||userId!==cloud.user?.id)return;
    if(error){
      cloud.dirty=true;
      if(error.code==='42501'){++cloud.epoch;clearContent();authPage('blocked','Seu acesso não está ativo.');return;}
      if(error.code==='40001'){
        cloud.conflict=true;saveStatus('Conflito entre dispositivos',true);
        cloudNotice('Há um avanço mais recente em outro dispositivo. Baixe seu avanço atual antes de carregar a versão da nuvem.',{label:'Carregar avanço da nuvem',run:()=>{if(confirm('Carregar a versão da nuvem substituirá o avanço não salvo desta tela. Continuar?'))loadAccount();}});return;
      }
      throw error;
    }
    cloud.revision=data;cloud.lastSaved=snapshot;saveStatus('Avanço salvo na nuvem');cloudNotice('');
  }catch{
    if(epoch!==cloud.epoch)return;cloud.dirty=true;saveStatus('Avanço ainda não salvo',true);
    cloudNotice('Não foi possível salvar. Suas alterações continuam nesta tela; tente novamente ou baixe uma cópia.',{label:'Tentar salvar novamente',run:()=>flushProgress()});
  }finally{
    if(cloud.savingEpoch===epoch)cloud.saving=false;
    if(epoch===cloud.epoch&&cloud.ready&&!cloud.conflict&&JSON.stringify(state)!==snapshot)scheduleSave();
  }
}
document.addEventListener('input',()=>queueMicrotask(scheduleSave));
document.addEventListener('change',()=>queueMicrotask(scheduleSave));
document.addEventListener('click',()=>queueMicrotask(scheduleSave));
window.addEventListener('hashchange',()=>verifyAccess());
window.addEventListener('online',()=>{verifyAccess();flushProgress();});
window.addEventListener('beforeunload',e=>{if(cloud.ready&&(cloud.dirty||cloud.saving)){e.preventDefault();e.returnValue='';}});
$('#account-signout').addEventListener('click',async()=>{
  if(cloud.dirty&&!cloud.conflict)await flushProgress();
  if((cloud.dirty||cloud.saving)&&!confirm('Há alterações não salvas. Sair mesmo assim?'))return;
  ++cloud.epoch;clearContent();cloud.user=null;authPage();await cloud.client.auth.signOut();
});
async function adminRequest(action,fields={}){
  const {data,error}=await cloud.client.functions.invoke('course-admin',{body:{action,...fields}});
  if(error){let message='Não foi possível concluir. Confira sua conexão e permissão.';try{const response=await error.context.json();message=response.error||message;}catch{}throw Error(message);}
  if(data?.error)throw Error(data.error);return data;
}
async function renderAdmin(){
  if(!cloud.ready||!cloud.admin)return;
  $('#breadcrumb').textContent='Administração / Alunos';
  $('#main').innerHTML=heading('ADMINISTRAÇÃO','Alunos e convites','Gerencie quem pode acessar o curso. Remover acesso preserva o histórico do aluno.')+`<form class="admin-invite" id="invite-form"><label>E-mail do novo aluno<input name="email" type="email" required maxlength="254" placeholder="aluno@exemplo.com"></label><button class="button">Enviar convite</button></form><div id="admin-feedback" role="status"></div><div class="admin-page-meta"><p id="admin-summary">Carregando alunos...</p><button class="button secondary" id="refresh-users">Atualizar lista</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Aluno</th><th>Acesso</th><th>Avanço</th><th>Último avanço</th><th>Ação</th></tr></thead><tbody id="admin-users"></tbody></table></div><dialog class="confirm-dialog" id="access-confirm"><h2 id="confirm-title"></h2><p id="confirm-description"></p><div class="confirm-actions"><button class="button secondary" id="cancel-access">Cancelar</button><button class="button" id="confirm-access">Confirmar</button></div></dialog>`;
  const delivery=document.createElement('fieldset');delivery.className='invite-delivery';delivery.innerHTML='<legend>Forma de convite</legend><label><input type="radio" name="delivery" value="link" checked> Gerar link</label><label><input type="radio" name="delivery" value="email"> Enviar e-mail</label>';
  $('#invite-form').insertBefore(delivery,$('button',$('#invite-form')));$('button',$('#invite-form')).textContent='Criar convite';
  $('#invite-form').addEventListener('submit',async e=>{
    e.preventDefault();const button=$('button',e.target);button.disabled=true;
    try{
      const form=new FormData(e.target),email=String(form.get('email')).trim();
      const result=await adminRequest('invite',{email,delivery:String(form.get('delivery'))});
      const feedback=$('#admin-feedback');feedback.textContent=result.message+' '+email+'.';
      if(result.invite_url){
        const label=document.createElement('label');label.className='invite-result';label.textContent='Link individual do convite';
        const input=document.createElement('textarea');input.readOnly=true;input.value=result.invite_url;input.rows=3;input.onclick=()=>input.select();label.append(input);feedback.append(label);
        const copy=document.createElement('button');copy.className='button secondary';copy.textContent='Copiar link';copy.onclick=async()=>{try{await navigator.clipboard.writeText(result.invite_url);toast('Link copiado. Entregue somente ao aluno convidado.');}catch{input.select();toast('Selecione o link e copie pelo navegador.');}};feedback.append(copy);
      }
      e.target.reset();await listStudents();
    }catch(error){$('#admin-feedback').textContent=error.message;}
    finally{button.disabled=false;}
  });
  $('#refresh-users').onclick=listStudents;await listStudents();
}
async function listStudents(){
  const target=$('#admin-users');if(!target)return;
  try{
    const result=await adminRequest('list');if(!target.isConnected)return;
    $('#admin-summary').textContent=`${result.users.length} alunos · ${result.users.filter(u=>u.status==='active').length} com acesso ativo`;
    target.innerHTML=result.users.length?result.users.map(u=>`<tr><td>${esc(u.email)}${u.is_admin?'<br><small>Administrador</small>':''}</td><td><span class="access-status ${u.status==='revoked'?'revoked':''}">${u.status==='active'?'Ativo':'Removido'}</span></td><td>${u.completed}/32 · ${Math.round(u.completed/32*100)}%</td><td>${u.updated_at?esc(new Date(u.updated_at).toLocaleDateString('pt-BR')):'Sem avanço'}</td><td>${u.is_admin?'Conta protegida':`<button data-user="${esc(u.user_id)}" data-action="${u.status==='active'?'revoke':'restore'}" class="${u.status==='active'?'revoke':''}">${u.status==='active'?'Remover acesso':'Restaurar acesso'}</button>`}</td></tr>`).join(''):'<tr><td colspan="5">Nenhum aluno convidado.</td></tr>';
    target.querySelectorAll('[data-user]').forEach(button=>button.addEventListener('click',()=>confirmAccess(button.dataset.user,button.dataset.action,result.users.find(u=>u.user_id===button.dataset.user).email)));
  }catch(error){if($('#admin-feedback'))$('#admin-feedback').textContent=error.message;}
}
function confirmAccess(userId,action,email){
  const dialog=$('#access-confirm'),remove=action==='revoke';$('#confirm-title').textContent=remove?'Remover acesso?':'Restaurar acesso?';
  $('#confirm-description').textContent=remove?`${email} perderá acesso às novas consultas do curso. O progresso será preservado.`:`${email} poderá acessar novamente e continuar com o progresso preservado.`;
  $('#cancel-access').onclick=()=>dialog.close();$('#confirm-access').onclick=async()=>{const button=$('#confirm-access');button.disabled=true;try{const result=await adminRequest(action,{userId});dialog.close();$('#admin-feedback').textContent=result.message;await listStudents();}catch(error){dialog.close();$('#admin-feedback').textContent=error.message;}finally{button.disabled=false;}};dialog.showModal();
}
async function startPrivateCourse(){
  document.body.classList.add('access-locked');
  if(!config.supabaseUrl||!config.publicKey){authPage('setup');return;}
  try{
    const url=new URL(config.supabaseUrl);if(url.protocol!=='https:')throw Error('URL inválida.');
    if(config.publicKey.startsWith('sb_secret_'))throw Error('Chave secreta não pode ser usada no navegador.');
    if(config.publicKey.startsWith('eyJ')){const payload=JSON.parse(atob(config.publicKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role!=='anon')throw Error('Use apenas a chave pública anon.');}
    if(!window.supabase?.createClient)throw Error('SDK indisponível.');
    cloud.client=window.supabase.createClient(config.supabaseUrl,config.publicKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    cloud.client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_IN'&&cloud.user&&session?.user?.id!==cloud.user.id){
        ++cloud.epoch;clearContent();cloud.user=null;authPage();setTimeout(()=>loadAccount(),0);
      }
      if(event==='PASSWORD_RECOVERY'){pendingPassword=true;setTimeout(()=>loadAccount(),0);}
      if(event==='SIGNED_OUT'){++cloud.epoch;cloud.user=null;clearContent();authPage();}
    });
    await loadAccount();
  }catch{authPage('setup','Não foi possível conectar o acesso. O responsável precisa conferir a configuração.');}
}
startPrivateCourse();
