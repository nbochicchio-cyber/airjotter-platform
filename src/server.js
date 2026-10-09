import 'dotenv/config';
import crypto from 'node:crypto'; import express from 'express'; import http from 'node:http'; import cookieParser from 'cookie-parser'; import jwt from 'jsonwebtoken'; import pg from 'pg'; import {Server} from 'socket.io'; import {OAuth2Client} from 'google-auth-library'; import QRCode from 'qrcode'; import {createClient} from 'redis'; import {createAdapter} from '@socket.io/redis-adapter';
import path from 'node:path';
import Stripe from 'stripe';
import {initializeApp as initializeFirebaseAdmin,applicationDefault,getApps as getFirebaseApps} from 'firebase-admin/app';
import {getAuth as getFirebaseAdminAuth} from 'firebase-admin/auth';
const app=express(), server=http.createServer(app), io=new Server(server,{maxHttpBufferSize:25e6,connectionStateRecovery:{maxDisconnectionDuration:120000,skipMiddlewares:false}});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}); const google=new OAuth2Client(process.env.GOOGLE_CLIENT_ID); const secret=process.env.JWT_SECRET||'dev-only-change-me';
const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY):null;
let firebaseAdminAuth=null;try{if(process.env.GOOGLE_APPLICATION_CREDENTIALS){if(!getFirebaseApps().length)initializeFirebaseAdmin({credential:applicationDefault()});firebaseAdminAuth=getFirebaseAdminAuth();console.log('FIREBASE AUTH AIRJOTTER ATTIVO')}}catch(error){console.error('Firebase Admin non inizializzato:',error.message)}
const appBaseUrl=process.env.APP_BASE_URL||process.env.APP_URL||'http://localhost:3000';
app.post('/api/billing/stripe/webhook',express.raw({type:'application/json'}),stripeWebhookHandler);
app.use(express.json({limit:'25mb'})); app.use(cookieParser()); app.use(express.static('public'));
const codeAlphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(){const b=crypto.randomBytes(8); let s=''; for(let i=0;i<8;i++)s+=codeAlphabet[b[i]%codeAlphabet.length]; return s.slice(0,4)+'-'+s.slice(4)}
function tokenFor(u,identity={}){return jwt.sign({sub:u.id,email:u.email,name:u.display_name,authProvider:identity.authProvider||'dev',googleSub:identity.googleSub||'',emailVerified:Boolean(identity.emailVerified)},secret,{expiresIn:'7d'})}
async function auth(req,res,next){try{req.user=jwt.verify(req.cookies.aj_session||'',secret);const u=await pool.query('SELECT is_suspended FROM users WHERE id=$1',[req.user.sub]);if(!u.rows[0])return res.status(401).json({error:'Account non disponibile'});if(u.rows[0].is_suspended)return res.status(403).json({error:'Account sospeso. Contatta il titolare di AirJotter.'});next()}catch{return res.status(401).json({error:'Autenticazione richiesta'})}}
const PLAN_LIMITS={free:{boards:1,pages:2},plus:{boards:5,pages:10},ultra:{boards:20,pages:50},unlimited:{boards:Number.MAX_SAFE_INTEGER,pages:50}};
const ADMIN_EMAIL='nbochicchio@gmail.com';
// AIRJOTTER_ADMIN_GDPR_RECOVERY_V1932B2
const AJ_PRIVACY_VERSION='PRIVACY-2026-10-07';
const AJ_TERMS_VERSION='TERMS-2026-10-07';
function legalAcceptance(body,method){const a=body?.legalAcceptance||{};return {valid:a.privacyAcknowledged===true&&a.termsAccepted===true&&a.privacyVersion===AJ_PRIVACY_VERSION&&a.termsVersion===AJ_TERMS_VERSION,privacyVersion:String(a.privacyVersion||''),termsVersion:String(a.termsVersion||''),method}}
// AIRJOTTER_AUTH_GDPR_AUTO_MIGRATION_V1932C
async function ensureLegalAcceptanceSchema(client){
 await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_notice_version TEXT');
 await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_notice_acknowledged_at TIMESTAMPTZ');
 await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT');
 await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ');
 await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_method TEXT');
 await client.query(`CREATE TABLE IF NOT EXISTS user_legal_acceptance_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email_snapshot TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('registration_acceptance','consent_withdrawal','profile_deletion_request')),
  privacy_notice_version TEXT,
  terms_version TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method TEXT NOT NULL CHECK(method IN ('email','google','admin')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
 )`);
 await client.query('CREATE INDEX IF NOT EXISTS user_legal_acceptance_user_idx ON user_legal_acceptance_events(user_id,occurred_at DESC)');
 await client.query('CREATE INDEX IF NOT EXISTS user_legal_acceptance_email_idx ON user_legal_acceptance_events(lower(email_snapshot),occurred_at DESC)');
}
async function recordRegistrationAcceptance(client,user,email,acceptance){
 await ensureLegalAcceptanceSchema(client);
 await client.query(`UPDATE users SET privacy_notice_version=$1,privacy_notice_acknowledged_at=COALESCE(privacy_notice_acknowledged_at,now()),terms_version=$2,terms_accepted_at=COALESCE(terms_accepted_at,now()),registration_method=COALESCE(registration_method,$3) WHERE id=$4`,[acceptance.privacyVersion,acceptance.termsVersion,acceptance.method,user.id]);
 await client.query(`INSERT INTO user_legal_acceptance_events(id,user_id,email_snapshot,event_type,privacy_notice_version,terms_version,method,evidence) VALUES($1,$2,$3,'registration_acceptance',$4,$5,$6,$7)`,[crypto.randomUUID(),user.id,email,acceptance.privacyVersion,acceptance.termsVersion,acceptance.method,JSON.stringify({serverRecorded:true,affirmativeAction:true})]);
}function adminOnly(req,res,next){const emailOk=String(req.user?.email||'').toLowerCase()===ADMIN_EMAIL;if(!emailOk)return res.sendStatus(403);if(process.env.NODE_ENV==='production'){const subOk=Boolean(process.env.ADMIN_GOOGLE_SUB)&&req.user.authProvider==='google'&&req.user.emailVerified===true&&req.user.googleSub===process.env.ADMIN_GOOGLE_SUB;if(!subOk)return res.status(403).json({error:'Consolle riservata al titolare autenticato con Google'})}next()}
async function resolvedPlan(userId){const q=await pool.query(`SELECT u.plan_code,u.email,u.spot_exports,u.spot_credit_cents,p.*,(SELECT COALESCE(sum(units),0) FROM user_extra_entitlements e WHERE e.user_id=u.id AND e.kind='jotter' AND e.expires_at>now()) active_extra_jotters,(SELECT COALESCE(sum(units),0) FROM user_extra_entitlements e WHERE e.user_id=u.id AND e.kind='page' AND e.expires_at>now()) active_extra_pages FROM users u LEFT JOIN LATERAL (SELECT bp.* FROM billing_plans bp WHERE bp.id=u.plan_id OR (u.plan_id IS NULL AND bp.code=u.plan_code) ORDER BY (bp.id=u.plan_id) DESC LIMIT 1) p ON true WHERE u.id=$1`,[userId]);const r=q.rows[0]||{};const fallback=PLAN_LIMITS[r.plan_code]||PLAN_LIMITS.free;if(String(r.email||'').toLowerCase()===ADMIN_EMAIL)return {id:null,code:'unlimited',name:'Unlimited',boards:Number.MAX_SAFE_INTEGER,pages:50,notes:1000000,freePdfPages:null,spotJotters:0,spotPages:Number(r.active_extra_pages||0),spotExports:Number(r.spot_exports||0),spotCreditCents:Number(r.spot_credit_cents||0),status:'active'};return {id:r.id||null,code:r.code||r.plan_code||'free',name:r.name||r.plan_code||'Free',boards:Number(r.boards_limit||fallback.boards),pages:Number(r.pages_limit||fallback.pages),notes:Number(r.notes_limit ?? fallback.notes ?? 10),freePdfPages:String(r.code||r.plan_code||'free').toLowerCase()==='free'?Math.max(0,Number(r.exports_limit??1)):null,spotJotters:Number(r.active_extra_jotters||0),spotPages:Number(r.active_extra_pages||0),spotExports:Number(r.spot_exports||0),spotCreditCents:Number(r.spot_credit_cents||0),status:r.status||'active'};}
async function userPlan(userId){return (await resolvedPlan(userId)).code}
async function boardPageLimit(boardId){const x=await pool.query('SELECT owner_user_id FROM boards WHERE id=$1',[boardId]);if(!x.rows[0])return PLAN_LIMITS.free.pages;const p=await resolvedPlan(x.rows[0].owner_user_id);const extra=Number((await pool.query("SELECT COALESCE(sum(units),0) n FROM user_extra_entitlements WHERE board_id=$1 AND kind='page' AND expires_at>now()",[boardId])).rows[0].n);return p.pages+extra}

async function activeBoardIds(){
 const ids=new Set();
 for(const [room,sockets] of io.of('/').adapter.rooms){
  if(typeof room!=='string'||!room.startsWith('board:'))continue;
  const boardId=room.slice(6);
  for(const socketId of sockets){const socket=io.of('/').sockets.get(socketId);if(socket?.connected){ids.add(boardId);break}}
 }
 return ids;
}
async function queueEmptyOwnedBoards(userId,currentBoardId=null){
 const active=await activeBoardIds();
 const q=await pool.query(`SELECT b.id FROM boards b
  WHERE b.owner_user_id=$1 AND ($2::uuid IS NULL OR b.id<>$2::uuid)
  AND NOT EXISTS(SELECT 1 FROM board_members bm WHERE bm.board_id=b.id AND bm.user_id<>b.owner_user_id)
  AND NOT EXISTS(SELECT 1 FROM access_requests ar WHERE ar.board_id=b.id AND ar.status='pending')
  AND NOT EXISTS(
   SELECT 1 FROM board_operations bo WHERE bo.board_id=b.id AND bo.is_active=true
   AND bo.operation_type IN ('command:add','stroke:add','text:add')
   AND bo.revision>COALESCE((SELECT max(c.revision) FROM board_operations c WHERE c.board_id=b.id AND c.is_active=true AND c.operation_type='board:clear'),0)
  )`,[userId,currentBoardId]);
 const ids=q.rows.map(x=>x.id);
 if(ids.length)await pool.query("UPDATE boards SET empty_cleanup_after=COALESCE(empty_cleanup_after,now()+interval '30 seconds') WHERE owner_user_id=$1 AND id=ANY($2::uuid[])",[userId,ids]);
 return ids;
}
async function cancelEmptyCleanup(boardId,userId){await pool.query('UPDATE boards SET empty_cleanup_after=NULL WHERE id=$1 AND owner_user_id=$2',[boardId,userId])}
async function deleteDueEmptyBoards(){
 const active=await activeBoardIds();
 const q=await pool.query(`SELECT b.id,b.owner_user_id FROM boards b WHERE b.empty_cleanup_after<=now()
  AND NOT EXISTS(SELECT 1 FROM board_members bm WHERE bm.board_id=b.id AND bm.user_id<>b.owner_user_id)
  AND NOT EXISTS(SELECT 1 FROM access_requests ar WHERE ar.board_id=b.id AND ar.status='pending')
  AND NOT EXISTS(
   SELECT 1 FROM board_operations bo WHERE bo.board_id=b.id AND bo.is_active=true
   AND bo.operation_type IN ('command:add','stroke:add','text:add')
   AND bo.revision>COALESCE((SELECT max(c.revision) FROM board_operations c WHERE c.board_id=b.id AND c.is_active=true AND c.operation_type='board:clear'),0)
  )`);
 const ids=q.rows.map(x=>x.id).filter(id=>!active.has(id));
 if(ids.length){await pool.query("UPDATE user_extra_entitlements SET board_id=NULL WHERE board_id=ANY($1::uuid[]) AND kind='jotter' AND expires_at>now()",[ids]);await pool.query('DELETE FROM boards WHERE id=ANY($1::uuid[])',[ids])}return ids;
}
// AIRJOTTER_SERVER_V22106126_DELETE_CLEARED_ON_OWNER_CLOSE
const clearedBoardDeleteTimers=new Map();
function cancelClearedBoardDelete(boardId){const t=clearedBoardDeleteTimers.get(boardId);if(t)clearTimeout(t);clearedBoardDeleteTimers.delete(boardId)}
function scheduleClearedBoardDelete(boardId,userId){
 if(!boardId||!userId)return;cancelClearedBoardDelete(boardId);
 const timer=setTimeout(async()=>{clearedBoardDeleteTimers.delete(boardId);try{
  const room=io.of('/').adapter.rooms.get(`board:${boardId}`);let ownerStillConnected=false;
  for(const socketId of room||[]){const live=io.of('/').sockets.get(socketId);if(live?.connected&&live.user?.sub===userId){ownerStillConnected=true;break}}
  if(ownerStillConnected)return;
  const q=await pool.query(`SELECT b.id FROM boards b WHERE b.id=$1 AND b.owner_user_id=$2
   AND EXISTS(SELECT 1 FROM board_operations c WHERE c.board_id=b.id AND c.is_active=true AND c.operation_type='board:clear')
   AND NOT EXISTS(SELECT 1 FROM board_operations v WHERE v.board_id=b.id AND v.is_active=true
    AND v.operation_type IN ('command:add','stroke:add','text:add')
    AND v.revision>(SELECT max(c.revision) FROM board_operations c WHERE c.board_id=b.id AND c.is_active=true AND c.operation_type='board:clear'))`,[boardId,userId]);
  if(!q.rows[0])return;
  await pool.query("UPDATE user_extra_entitlements SET board_id=NULL WHERE board_id=$1 AND user_id=$2 AND kind='jotter' AND expires_at>now()",[boardId,userId]);
  await pool.query('DELETE FROM boards WHERE id=$1 AND owner_user_id=$2',[boardId,userId]);
 }catch(e){console.error('Eliminazione Jotter svuotato alla chiusura:',e)}} ,8000);
 clearedBoardDeleteTimers.set(boardId,timer);
}
// AIRJOTTER_SERVER_V225_FREE_EXPORT
// AIRJOTTER_SERVER_V224_REALTIME_INK
// AIRJOTTER_SERVER_V158
async function cleanupOwnerEmptyBoardsNow(userId){
 await pool.query("UPDATE user_extra_entitlements e SET board_id=NULL FROM boards b WHERE e.board_id=b.id AND e.user_id=$1 AND e.kind='jotter' AND e.expires_at>now() AND b.owner_user_id=$1 AND b.is_empty=true AND b.is_current=false",[userId]);
 const q=await pool.query(`DELETE FROM boards b WHERE b.owner_user_id=$1 AND b.is_empty=true AND b.is_current=false RETURNING b.id`,[userId]);
 return q.rows.map(x=>x.id);
}
async function startupCleanup(userId){
 try{return await cleanupOwnerEmptyBoardsNow(userId)}catch(e){console.warn('Pulizia avvio non bloccante:',e.message);return []}
}
async function role(boardId,userId){const q=await pool.query('SELECT role,status FROM board_members WHERE board_id=$1 AND user_id=$2',[boardId,userId]); return q.rows[0]}

function planPublic(row){const free=String(row.code).toLowerCase()==='free';return {id:row.id,code:row.code,name:row.name,description:free?'Piano gratuito con watermark AirJotter.com permanente su ogni pagina, incluso negli export completi acquistati.':row.description,status:row.status,billingType:row.billing_type,currency:row.currency,amountCents:Number(row.amount_cents),intervalUnit:row.interval_unit,intervalCount:Number(row.interval_count||1),minSeats:Number(row.min_seats||1),maxSeats:row.max_seats==null?null:Number(row.max_seats),limits:{boards:Number(row.boards_limit),pages:Number(row.pages_limit),notes:Number(row.notes_limit ?? 10),guests:row.guests_limit,exports:row.exports_limit,historyDays:row.history_days,freePdfPages:String(row.code).toLowerCase()==='free'?Math.max(0,Number(row.exports_limit??1)):null},included:{jotters:Number(row.included_spot_jotters||0),pages:Number(row.included_spot_pages||0),exports:Number(row.included_spot_exports||0)},features:Array.isArray(row.features)?row.features:[],consumableKind:row.consumable_kind,consumableUnits:Number(row.consumable_units||0),sortOrder:Number(row.sort_order||0),featured:Boolean(row.featured),public:Boolean(row.public),stripeReady:Boolean(row.stripe_price_id),paypalReady:Boolean(row.paypal_plan_id)}}
async function planById(id){return (await pool.query('SELECT * FROM billing_plans WHERE id=$1',[id])).rows[0]}
async function paypalToken(){if(!process.env.PAYPAL_CLIENT_ID||!process.env.PAYPAL_CLIENT_SECRET)return null;const base=process.env.PAYPAL_ENV==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';const auth=Buffer.from(process.env.PAYPAL_CLIENT_ID+':'+process.env.PAYPAL_CLIENT_SECRET).toString('base64');const r=await fetch(base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});if(!r.ok)throw new Error('Autenticazione PayPal non riuscita');return {base,token:(await r.json()).access_token}}
// AIRJOTTER_STRIPE_LIVE_PROVISION_V2300Q2: verifica gli ID nel conto Stripe corrente e ricrea solo gli oggetti assenti o incompatibili.
async function stripeObjectOrNull(kind,id){
 if(!id)return null;
 try{return kind==='product'?await stripe.products.retrieve(id):await stripe.prices.retrieve(id)}
 catch(error){if(error?.code==='resource_missing'||error?.statusCode===404)return null;throw error}
}
async function provisionStripe(plan){
 if(!stripe||plan.billing_type==='free')return {};
 let product=await stripeObjectOrNull('product',plan.stripe_product_id);
 if(!product||product.deleted){product=await stripe.products.create({name:'AirJotter '+plan.name,description:plan.description||undefined,metadata:{airjotter_plan_id:plan.id,airjotter_plan_code:plan.code||''}})}
 let price=await stripeObjectOrNull('price',plan.stripe_price_id);
 const productId=typeof price?.product==='string'?price.product:price?.product?.id;
 const expectedRecurring=(plan.billing_type==='subscription'||plan.billing_type==='per_seat')?{interval:plan.interval_unit||'month',interval_count:Number(plan.interval_count||1)}:null;
 const priceMatches=Boolean(price&&price.active!==false&&productId===product.id&&String(price.currency||'').toLowerCase()===String(plan.currency||'').toLowerCase()&&Number(price.unit_amount)===Number(plan.amount_cents)&&((!expectedRecurring&&!price.recurring)||(expectedRecurring&&price.recurring?.interval===expectedRecurring.interval&&Number(price.recurring?.interval_count||1)===expectedRecurring.interval_count)));
 if(!priceMatches){const priceParams={product:product.id,currency:plan.currency.toLowerCase(),unit_amount:Number(plan.amount_cents),metadata:{airjotter_plan_id:plan.id,airjotter_plan_code:plan.code||''}};if(expectedRecurring)priceParams.recurring=expectedRecurring;price=await stripe.prices.create(priceParams)}
 return {stripe_product_id:product.id,stripe_price_id:price.id,recreatedProduct:product.id!==plan.stripe_product_id,recreatedPrice:price.id!==plan.stripe_price_id};
}
// AIRJOTTER_PAYPAL_LIVE_PLAN_IDS_V2300S: valida prodotto e piano nel conto PayPal corrente; gli ID Sandbox non sono validi in Live.
async function paypalResourceOrNull(auth,resourcePath){
 if(!resourcePath)return null;
 const r=await fetch(auth.base+resourcePath,{headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'}});
 if(r.status===404)return null;
 const body=await r.json().catch(()=>({}));
 if(!r.ok){const e=new Error(body.message||'Verifica risorsa PayPal non riuscita');e.status=r.status;e.paypal=body;throw e}
 return body;
}
async function provisionPayPal(plan){
 if(plan.billing_type==='free'||plan.billing_type==='consumable')return {};
 const auth=await paypalToken();if(!auth)return {};
 let product=await paypalResourceOrNull(auth,plan.paypal_product_id?'/v1/catalogs/products/'+encodeURIComponent(plan.paypal_product_id):null);
 if(!product){
  const r=await fetch(auth.base+'/v1/catalogs/products',{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json','PayPal-Request-Id':crypto.randomUUID()},body:JSON.stringify({name:'AirJotter '+plan.name,description:plan.description||plan.name,type:'SERVICE',category:'SOFTWARE'})});
  const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.message||'Creazione prodotto PayPal non riuscita');product=body;
 }
 let remotePlan=await paypalResourceOrNull(auth,plan.paypal_plan_id?'/v1/billing/plans/'+encodeURIComponent(plan.paypal_plan_id):null);
 const cycle=remotePlan?.billing_cycles?.find(x=>x.tenure_type==='REGULAR');
 const fixed=cycle?.pricing_scheme?.fixed_price;
 const matches=Boolean(remotePlan&&remotePlan.product_id===product.id&&remotePlan.status==='ACTIVE'&&String(fixed?.currency_code||'').toUpperCase()===String(plan.currency||'EUR').toUpperCase()&&Math.round(Number(fixed?.value||0)*100)===Number(plan.amount_cents)&&cycle?.frequency?.interval_unit===String(plan.interval_unit||'month').toUpperCase()&&Number(cycle?.frequency?.interval_count||1)===Number(plan.interval_count||1));
 if(!matches){
  const r=await fetch(auth.base+'/v1/billing/plans',{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json','PayPal-Request-Id':crypto.randomUUID()},body:JSON.stringify({product_id:product.id,name:plan.name,description:plan.description,status:'ACTIVE',billing_cycles:[{frequency:{interval_unit:(plan.interval_unit||'month').toUpperCase(),interval_count:Number(plan.interval_count||1)},tenure_type:'REGULAR',sequence:1,total_cycles:0,pricing_scheme:{fixed_price:{value:(Number(plan.amount_cents)/100).toFixed(2),currency_code:plan.currency}}}],payment_preferences:{auto_bill_outstanding:true,payment_failure_threshold:1}})});
  const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.message||'Creazione piano PayPal non riuscita');remotePlan=body;
 }
 return {paypal_product_id:product.id,paypal_plan_id:remotePlan.id,recreatedProduct:product.id!==plan.paypal_product_id,recreatedPlan:remotePlan.id!==plan.paypal_plan_id};
}
async function grantPurchase(client,userId,plan,provider,externalId,status='paid'){
 if(plan.billing_type==='consumable'){const column={jotter:'spot_jotters',page:'spot_pages',export:'spot_exports'}[plan.consumable_kind];if(column)await client.query(`UPDATE users SET ${column}=${column}+$1 WHERE id=$2`,[Number(plan.consumable_units||1),userId]);}
 else await applyPlanAndExtendExtras(client,userId,plan,provider,externalId);
}
function stripePeriodEnd(sub){
 const values=[sub?.current_period_end,...(sub?.items?.data||[]).map(x=>x?.current_period_end)].map(Number).filter(Number.isFinite);
 return values.length?new Date(Math.max(...values)*1000):null;
}
async function stripePlanFromSubscription(sub){
 const priceId=sub?.items?.data?.[0]?.price?.id||sub?.items?.data?.[0]?.price||null;
 if(!priceId)return null;
 return (await pool.query('SELECT * FROM billing_plans WHERE stripe_price_id=$1 LIMIT 1',[priceId])).rows[0]||null;
}
async function reconcileStripeCheckoutSession(session,userId){
 if(!stripe)throw new Error('Stripe non configurato');
 if(!session||String(session.client_reference_id||'')!==String(userId))throw new Error('Sessione Stripe non associata a questo account');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[String(userId)+':stripe:'+session.id]);
  if(session.metadata?.kind==='credit_topup'){
   const cents=Number(session.metadata.amountCents||session.amount_total||0);
   if(session.payment_status!=='paid')throw new Error('Pagamento carta non ancora completato');
   const ins=await c.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,provider,external_id,description) SELECT $1,$2,'topup',$3,'credit','stripe',$4,'Ricarica credito con carta' WHERE NOT EXISTS (SELECT 1 FROM pay_use_transactions WHERE provider='stripe' AND external_id=$4) RETURNING id",[crypto.randomUUID(),userId,cents,session.id]);
   if(ins.rowCount)await c.query('UPDATE users SET spot_credit_cents=spot_credit_cents+$1 WHERE id=$2',[cents,userId]);
   await c.query("UPDATE billing_orders SET status='paid',updated_at=now(),raw=$1 WHERE external_id=$2",[session,session.id]);
   const balance=Number((await c.query('SELECT spot_credit_cents FROM users WHERE id=$1',[userId])).rows[0]?.spot_credit_cents||0);
   await c.query('COMMIT');
   return {kind:'credit',duplicate:!ins.rowCount,creditedCents:cents,balanceCents:balance};
  }
  const plan=await planById(session.metadata?.planId);
  if(!plan)throw new Error('Piano Stripe non riconosciuto');
  let sub=null;
  if(session.subscription){const subId=typeof session.subscription==='string'?session.subscription:session.subscription?.id;sub=subId?await stripe.subscriptions.retrieve(subId,{expand:['items.data.price']}):session.subscription}
  const current=(await c.query('SELECT plan_code,subscription_external_id FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0]||{};
  const subscriptionId=typeof session.subscription==='string'?session.subscription:(session.subscription?.id||session.id);
  if(current.plan_code!==plan.code||current.subscription_external_id!==subscriptionId)await applyPlanAndExtendExtras(c,userId,plan,'stripe',subscriptionId);
  const end=stripePeriodEnd(sub);
  await c.query("UPDATE users SET billing_customer_id=COALESCE($1,billing_customer_id),subscription_status=$2,subscription_current_period_end=COALESCE($3,subscription_current_period_end) WHERE id=$4",[String(session.customer||sub?.customer||'')||null,sub?.cancel_at_period_end?'cancel_at_period_end':(sub?.status||'active'),end,userId]);
  await c.query("UPDATE billing_orders SET status='paid',updated_at=now(),raw=$1 WHERE external_id=$2",[session,session.id]);
  await c.query('COMMIT');
  return {kind:'subscription',plan:{code:plan.code,name:plan.name},amountCents:Number(plan.amount_cents),currentPeriodEnd:end?.toISOString()||null,cancelAtPeriodEnd:Boolean(sub?.cancel_at_period_end)};
 }catch(e){try{await c.query('ROLLBACK')}catch{};throw e}finally{c.release()}
}
async function stripeWebhookHandler(req,res){
 if(!stripe||!process.env.STRIPE_WEBHOOK_SECRET)return res.status(503).send('Stripe non configurato');
 let event;
 try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET)}catch(e){return res.status(400).send('Firma webhook non valida')}
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const once=await c.query('INSERT INTO billing_webhook_events(provider,external_event_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING external_event_id',['stripe',event.id,event]);
  if(!once.rowCount){await c.query('ROLLBACK');return res.json({received:true,duplicate:true})}
  await c.query('COMMIT');
 }catch(e){try{await c.query('ROLLBACK')}catch{};c.release();console.error('Webhook Stripe registro evento:',e);return res.sendStatus(500)}
 c.release();
 try{
  if(event.type==='checkout.session.completed'){
   await reconcileStripeCheckoutSession(event.data.object,event.data.object.client_reference_id);
  }else if(event.type==='customer.subscription.created'||event.type==='customer.subscription.updated'){
   const sub=event.data.object,plan=await stripePlanFromSubscription(sub),end=stripePeriodEnd(sub);
   const user=(await pool.query('SELECT id,plan_code FROM users WHERE subscription_external_id=$1 OR ($2<>\'\' AND id::text=$2) LIMIT 1',[sub.id,String(sub.metadata?.airjotterUserId||'')])).rows[0];
   if(user){
    const tx=await pool.connect();try{await tx.query('BEGIN');if(plan&&user.plan_code!==plan.code)await applyPlanAndExtendExtras(tx,user.id,plan,'stripe',sub.id);await tx.query("UPDATE users SET billing_customer_id=COALESCE($1,billing_customer_id),subscription_status=$2,subscription_current_period_end=COALESCE($3,subscription_current_period_end) WHERE id=$4",[String(sub.customer||'')||null,sub.cancel_at_period_end?'cancel_at_period_end':sub.status,end,user.id]);await tx.query('COMMIT')}catch(e){await tx.query('ROLLBACK');throw e}finally{tx.release()}
   }
  }else if(event.type==='customer.subscription.deleted'){
   const sub=event.data.object,free=(await pool.query("SELECT id FROM billing_plans WHERE code='free' LIMIT 1")).rows[0];
   if(free)await pool.query("UPDATE users SET plan_id=$1,plan_code='free',subscription_status='cancelled',subscription_provider=NULL,subscription_external_id=NULL,billing_customer_id=NULL WHERE subscription_external_id=$2",[free.id,sub.id]);
  }else if(event.type==='customer.subscription.paused'){
   await pool.query("UPDATE users SET subscription_status='suspended' WHERE subscription_external_id=$1",[event.data.object.id]);
  }else if(event.type==='invoice.paid'){
   const inv=event.data.object,subId=typeof inv.subscription==='string'?inv.subscription:inv.subscription?.id;
   if(subId){const sub=await stripe.subscriptions.retrieve(subId,{expand:['items.data.price']});const plan=await stripePlanFromSubscription(sub),end=stripePeriodEnd(sub);const user=(await pool.query('SELECT id,plan_code FROM users WHERE subscription_external_id=$1 LIMIT 1',[subId])).rows[0];if(user){const tx=await pool.connect();try{await tx.query('BEGIN');if(plan&&user.plan_code!==plan.code)await applyPlanAndExtendExtras(tx,user.id,plan,'stripe',subId);await tx.query("UPDATE users SET subscription_status='active',subscription_current_period_end=COALESCE($1,subscription_current_period_end) WHERE id=$2",[end,user.id]);await tx.query('COMMIT')}catch(e){await tx.query('ROLLBACK');throw e}finally{tx.release()}}}
  }else if(event.type==='invoice.payment_failed'){
   const inv=event.data.object;await pool.query("UPDATE users SET subscription_status='past_due' WHERE billing_customer_id=$1",[String(inv.customer||'')]);
  }
  res.json({received:true});
 }catch(e){console.error('Webhook Stripe:',e);res.sendStatus(500)}
}
// AIRJOTTER FILE TRANSFER V22.9.8 - P2P diretto, nessun relay TURN

// AIRJOTTER_PAYPAL_V1959: webhook verificato, provisioning Sandbox e stati abbonamento.
async function verifyPayPalWebhook(req,event){
 const auth=await paypalToken();if(!auth||!process.env.PAYPAL_WEBHOOK_ID)return false;
 const r=await fetch(auth.base+'/v1/notifications/verify-webhook-signature',{method:'POST',headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json'},body:JSON.stringify({auth_algo:req.headers['paypal-auth-algo'],cert_url:req.headers['paypal-cert-url'],transmission_id:req.headers['paypal-transmission-id'],transmission_sig:req.headers['paypal-transmission-sig'],transmission_time:req.headers['paypal-transmission-time'],webhook_id:process.env.PAYPAL_WEBHOOK_ID,webhook_event:event})});
 if(!r.ok)return false;return (await r.json()).verification_status==='SUCCESS';
}
async function paypalWebhookHandler(req,res){
 const event=req.body;if(!event?.id)return res.status(400).json({error:'Evento PayPal non valido'});
 try{if(!(await verifyPayPalWebhook(req,event)))return res.status(400).json({error:'Firma PayPal non valida'});
  const c=await pool.connect();try{await c.query('BEGIN');const once=await c.query('INSERT INTO billing_webhook_events(provider,external_event_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING external_event_id',['paypal',event.id,event]);if(!once.rowCount){await c.query('ROLLBACK');return res.json({received:true,duplicate:true})}
   const type=event.event_type,r=event.resource||{},custom=String(r.custom_id||'').split('|'),userId=custom[0]||null,planId=custom[1]||null;
   if(type==='BILLING.SUBSCRIPTION.ACTIVATED'&&userId&&planId){const plan=await planById(planId);if(plan){await applyPlanAndExtendExtras(c,userId,plan,'paypal',r.id);await c.query("UPDATE users SET paypal_payer_id=COALESCE($1,paypal_payer_id),subscription_status='active' WHERE id=$2",[r.subscriber?.payer_id||null,userId]);await c.query("UPDATE billing_orders SET status='paid',raw=$1,updated_at=now() WHERE external_id=$2",[r,r.id])}}
   else if(['BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.SUSPENDED','BILLING.SUBSCRIPTION.EXPIRED'].includes(type)){await c.query("UPDATE users SET subscription_status=$1 WHERE subscription_external_id=$2",[type.endsWith('CANCELLED')?'cancelled':type.endsWith('EXPIRED')?'expired':'suspended',r.id])}
   else if(type==='BILLING.SUBSCRIPTION.PAYMENT.FAILED'){await c.query("UPDATE users SET subscription_status='past_due' WHERE subscription_external_id=$1",[r.id])}
   else if(type==='PAYMENT.SALE.COMPLETED'){const subId=r.billing_agreement_id||r.billing_agreement_id;const pending=(await c.query("SELECT * FROM billing_orders WHERE provider='paypal' AND kind='subscription' AND external_id=$1 AND status='approved_next_cycle' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[subId])).rows[0];if(pending){const nextPlan=await planById(pending.plan_id);if(nextPlan){await applyPlanAndExtendExtras(c,pending.user_id,nextPlan,'paypal',subId);await c.query("UPDATE billing_orders SET status='paid',raw=$1,updated_at=now() WHERE id=$2",[event,pending.id])}}else await c.query("UPDATE users SET subscription_status='active',subscription_current_period_end=GREATEST(COALESCE(subscription_current_period_end,now()),now())+interval '1 month' WHERE subscription_external_id=$1",[subId]);}
   await c.query('COMMIT');res.json({received:true});
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }catch(e){console.error('Webhook PayPal:',e);res.status(500).json({error:'Webhook PayPal non elaborato'})}
}
app.post('/api/billing/paypal/webhook',paypalWebhookHandler);
// AIRJOTTER_STRIPE_PROVISION_1966A
app.post('/api/admin/billing/stripe/provision',auth,adminOnly,async(req,res)=>{
 try{
  if(!stripe)return res.status(503).json({error:'Stripe non configurato'});
  const environment=process.env.STRIPE_ENV||'test';
  if(environment==='live'&&!req.body?.confirmLive)return res.status(400).json({error:'Provisioning Stripe Live non autorizzato'});
  const out=[];
  for(const code of ['plus','ultra']){
   let plan=(await pool.query('SELECT * FROM billing_plans WHERE code=$1',[code])).rows[0];
   if(!plan)continue;
   const remote=await provisionStripe(plan);
   plan=(await pool.query('UPDATE billing_plans SET stripe_product_id=$1,stripe_price_id=$2,updated_at=now() WHERE id=$3 RETURNING *',[remote.stripe_product_id,remote.stripe_price_id,plan.id])).rows[0];
   out.push({code:plan.code,name:plan.name,amountCents:Number(plan.amount_cents),currency:plan.currency,stripeProductId:plan.stripe_product_id,stripePriceId:plan.stripe_price_id,ready:Boolean(plan.stripe_price_id),recreatedProduct:Boolean(remote.recreatedProduct),recreatedPrice:Boolean(remote.recreatedPrice)});
  }
  res.json({ok:true,environment,plans:out});
 }catch(e){console.error('Provisioning Stripe V2300Q2:',{type:e?.type||null,code:e?.code||null,message:e?.message||String(e),requestId:e?.requestId||null});res.status(500).json({error:e.message||'Provisioning Stripe non riuscito'})}
});
app.post('/api/admin/billing/paypal/provision',auth,adminOnly,async(req,res)=>{
 try{
  const environment=process.env.PAYPAL_ENV||'sandbox';
  if(environment!=='sandbox'&&!req.body?.confirmLive)return res.status(400).json({error:'Provisioning Live non autorizzato'});
  const desired={plus:Math.round(Number(process.env.PAYPAL_PLUS_MONTHLY_EUR||4.99)*100),ultra:Math.round(Number(process.env.PAYPAL_ULTRA_MONTHLY_EUR||9.99)*100)},out=[];
  for(const code of ['plus','ultra']){
   let plan=(await pool.query('UPDATE billing_plans SET amount_cents=$1,currency=$2,interval_unit=$3,interval_count=1,status=$4,updated_at=now() WHERE code=$5 RETURNING *',[desired[code],'EUR','month','active',code])).rows[0];if(!plan)continue;
   const remote=await provisionPayPal(plan);
   plan=(await pool.query('UPDATE billing_plans SET paypal_product_id=$1,paypal_plan_id=$2,updated_at=now() WHERE id=$3 RETURNING *',[remote.paypal_product_id,remote.paypal_plan_id,plan.id])).rows[0];
   out.push({code:plan.code,name:plan.name,amountCents:Number(plan.amount_cents),currency:plan.currency,paypalProductId:plan.paypal_product_id,paypalPlanId:plan.paypal_plan_id,ready:Boolean(plan.paypal_plan_id),recreatedProduct:Boolean(remote.recreatedProduct),recreatedPlan:Boolean(remote.recreatedPlan)});
  }
  res.json({ok:true,environment,plans:out});
 }catch(e){console.error('Provisioning PayPal V2300S:',{status:e?.status||null,message:e?.message||String(e),debugId:e?.paypal?.debug_id||null});res.status(500).json({error:e.message||'Provisioning PayPal non riuscito'})}
});
// AIRJOTTER_FILE_TRANSFER_V2300
app.get('/api/file-transfer/ice',auth,(req,res)=>{
 const iceServers=[{urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']}];
 const turnUrls=String(process.env.TURN_URLS||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(turnUrls.length&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL)iceServers.push({urls:turnUrls,username:process.env.TURN_USERNAME,credential:process.env.TURN_CREDENTIAL});
 res.json({turnConfigured:iceServers.length>1,iceServers,notice:'Connessione P2P in preparazione'});
});
app.get('/api/plans',async(req,res)=>{const q=await pool.query("SELECT * FROM billing_plans WHERE status='active' AND public=true ORDER BY sort_order,name");res.json(q.rows.map(planPublic))});
app.get('/api/billing/config',(req,res)=>res.json({stripe:Boolean(process.env.STRIPE_PUBLISHABLE_KEY&&process.env.STRIPE_SECRET_KEY),stripePublishableKey:process.env.STRIPE_PUBLISHABLE_KEY||'',paypal:Boolean(process.env.PAYPAL_CLIENT_ID&&process.env.PAYPAL_CLIENT_SECRET),paypalClientId:process.env.PAYPAL_CLIENT_ID||'',paypalEnv:process.env.PAYPAL_ENV||'sandbox',creditPacksCents:String(process.env.PAYPAL_CREDIT_PACKS_EUR||'3,5,10,20').split(',').map(x=>Math.round(Number(x)*100)).filter(x=>x>=300)}));
// AIRJOTTER_PAYPAL_CANCEL_DOWNGRADE_V2300U: PayPal cancella subito il rinnovo, AirJotter conserva il piano pagato fino alla scadenza e poi passa a Free.
async function reconcilePayPalCancelledPlan(userId){
 const u=(await pool.query('SELECT plan_code,subscription_provider,subscription_status,subscription_current_period_end FROM users WHERE id=$1',[userId])).rows[0]||{};
 if(u.subscription_provider!=='paypal'||String(u.subscription_status||'').toLowerCase()!=='cancelled'||!u.subscription_current_period_end)return {changed:false,user:u};
 const end=new Date(u.subscription_current_period_end);if(!Number.isFinite(end.getTime())||end.getTime()>Date.now())return {changed:false,user:u};
 const free=(await pool.query("SELECT id FROM billing_plans WHERE code='free' LIMIT 1")).rows[0];if(!free)return {changed:false,user:u};
 await pool.query("UPDATE users SET plan_id=$1,plan_code='free',subscription_provider=NULL,subscription_external_id=NULL,billing_customer_id=NULL,subscription_current_period_end=NULL WHERE id=$2 AND subscription_provider='paypal' AND subscription_status='cancelled'",[free.id,userId]);
 return {changed:true,user:{...u,plan_code:'free'}};
}
// AIRJOTTER_SCHEDULED_PLAN_STATUS_1968
app.get('/api/billing/me',auth,async(req,res)=>{
 try{
  await reconcilePayPalCancelledPlan(req.user.sub);
  const p=await resolvedPlan(req.user.sub);
  const u=(await pool.query('SELECT email,subscription_current_period_end,subscription_provider,subscription_status,subscription_external_id,billing_customer_id FROM users WHERE id=$1',[req.user.sub])).rows[0]||{};
  // AIRJOTTER_BILLING_UI_3_FIX_V2300R2
  const orders=await pool.query("SELECT bo.id,bo.provider,bo.kind,bo.status,bo.amount_cents,bo.currency,bo.quantity,bo.created_at,bp.name AS plan_name,bp.code AS plan_code FROM billing_orders bo LEFT JOIN billing_plans bp ON bp.id=bo.plan_id WHERE bo.user_id=$1 ORDER BY bo.created_at DESC LIMIT 50",[req.user.sub]);
  let scheduledChange=null;
  const planSummary=async(code)=>{const x=(await pool.query('SELECT code,name,amount_cents,currency,boards_limit,pages_limit,exports_limit FROM billing_plans WHERE code=$1 LIMIT 1',[code])).rows[0];return x?{code:x.code,name:x.name,amountCents:Number(x.amount_cents||0),currency:x.currency||'EUR',limits:{boards:Number(x.boards_limit||1),pages:Number(x.pages_limit||2),freePdfPages:x.code==='free'?Math.max(0,Number(x.exports_limit??1)):null}}:null};
  if(stripe&&u.subscription_provider==='stripe'&&String(u.subscription_external_id||'').startsWith('sub_')){
   try{
    const sub=await stripe.subscriptions.retrieve(u.subscription_external_id,{expand:['items.data.price','schedule']});
    const endAt=stripePeriodEnd(sub)||u.subscription_current_period_end||null;
    if(sub.cancel_at_period_end){const target=await planSummary('free');if(target)scheduledChange={type:'downgrade',targetPlan:target,effectiveAt:endAt,provider:'stripe',externalId:sub.id,reason:'cancel_at_period_end'}}
    else{
     const scheduleId=typeof sub.schedule==='string'?sub.schedule:sub.schedule?.id;
     if(scheduleId){
      const sch=await stripe.subscriptionSchedules.retrieve(scheduleId);
      const now=Math.floor(Date.now()/1000),future=(sch.phases||[]).find(ph=>Number(ph.start_date)>now);
      const priceId=typeof future?.items?.[0]?.price==='string'?future.items[0].price:future?.items?.[0]?.price?.id;
      if(priceId){const targetRow=(await pool.query('SELECT code FROM billing_plans WHERE stripe_price_id=$1 LIMIT 1',[priceId])).rows[0];const target=targetRow?await planSummary(targetRow.code):null;if(target&&target.code!==p.code)scheduledChange={type:target.amountCents>Number(p.amount_cents||0)?'upgrade':'downgrade',targetPlan:target,effectiveAt:new Date(Number(future.start_date)*1000).toISOString(),provider:'stripe',externalId:scheduleId,reason:'subscription_schedule'}}
     }
    }
   }catch(e){console.warn('Lettura variazione Stripe non bloccante:',e.message)}
  }
  if(!scheduledChange&&u.subscription_provider==='paypal'&&String(u.subscription_status||'').toLowerCase()==='cancelled'&&u.subscription_current_period_end&&String(p.code||'').toLowerCase()!=='free'){
   const target=await planSummary('free');
   if(target)scheduledChange={type:'downgrade',targetPlan:target,effectiveAt:u.subscription_current_period_end,provider:'paypal',externalId:u.subscription_external_id||null,reason:'paypal_subscription_cancelled'};
  }
  if(!scheduledChange){
   const pending=(await pool.query("SELECT bo.provider,bo.status,bo.external_id,bo.raw,bp.code FROM billing_orders bo JOIN billing_plans bp ON bp.id=bo.plan_id WHERE bo.user_id=$1 AND bo.status IN ('approved_next_cycle','pending_cycle_upgrade') ORDER BY bo.updated_at DESC LIMIT 1",[req.user.sub])).rows[0];
   if(pending){const target=await planSummary(pending.code),effectiveAt=pending.raw?.effectiveAt||u.subscription_current_period_end||null;if(target&&target.code!==p.code)scheduledChange={type:target.amountCents>Number(p.amount_cents||0)?'upgrade':'downgrade',targetPlan:target,effectiveAt,provider:pending.provider,externalId:pending.external_id,reason:'billing_order'}}
  }
  const owned=Number((await pool.query('SELECT count(*) FROM boards WHERE owner_user_id=$1',[req.user.sub])).rows[0]?.count||0);
  if(scheduledChange)scheduledChange.impact={ownedJotters:owned,policyVersion:'1968'};
  res.json({plan:{...p,currentPeriodEnd:u.subscription_current_period_end||null,subscriptionProvider:u.subscription_provider||null,subscriptionStatus:u.subscription_status||null,subscriptionExternalId:u.subscription_external_id||null,cancelAtPeriodEnd:u.subscription_status==='cancel_at_period_end'||scheduledChange?.targetPlan?.code==='free',scheduledChange},orders:orders.rows});
 }catch(e){console.error('Stato billing 19.68:',e);res.status(500).json({error:'Impossibile caricare lo stato dell’abbonamento'})}
});
// AIRJOTTER_STRIPE_SAFE_CHECKOUT_1966C
app.post('/api/billing/stripe/checkout',auth,async(req,res)=>{
 try{
  if(!stripe)return res.status(503).json({error:'Stripe non configurato'});
  const plan=await planById(req.body.planId);
  if(!plan||plan.status!=='active'||!plan.public)return res.sendStatus(404);
  if(plan.billing_type==='free')return res.status(400).json({error:'Il piano Free non richiede pagamento'});
  if(!plan.stripe_price_id)return res.status(409).json({error:'Piano Stripe non ancora configurato'});
  const quantity=plan.billing_type==='per_seat'?Math.max(Number(plan.min_seats||1),Number(req.body.quantity||1)):Math.max(1,Number(req.body.quantity||1));
   const current=(await pool.query('SELECT plan_code,subscription_provider,subscription_external_id FROM users WHERE id=$1',[req.user.sub])).rows[0]||{};
   if(plan.code==='ultra'&&current.plan_code==='plus'&&current.subscription_provider==='stripe'&&String(current.subscription_external_id||'').startsWith('sub_'))return res.status(409).json({error:'Upgrade Stripe da programmare al rinnovo',code:'stripe_upgrade_required'});
  const session=await stripe.checkout.sessions.create({
   mode:plan.billing_type==='consumable'?'payment':'subscription',
   managed_payments:{enabled:false},
   line_items:[{price:plan.stripe_price_id,quantity}],
   client_reference_id:req.user.sub,
   customer_email:req.user.email,
   success_url:appBaseUrl+'/?billing=stripe-subscription-success&session_id={CHECKOUT_SESSION_ID}',
   cancel_url:appBaseUrl+'/?billing=cancel',
   metadata:{planId:plan.id,quantity:String(quantity)},
    subscription_data:{metadata:{airjotterUserId:req.user.sub,airjotterPlanId:plan.id}},
   allow_promotion_codes:true
  });
  await pool.query('INSERT INTO billing_orders(id,user_id,plan_id,provider,kind,external_id,status,amount_cents,currency,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[crypto.randomUUID(),req.user.sub,plan.id,'stripe',plan.billing_type==='consumable'?'one_time':'subscription',session.id,'pending',plan.amount_cents,plan.currency,quantity]);
  res.json({url:session.url});
 }catch(error){
  console.error('Stripe Checkout piano 19.66C:',{type:error?.type||null,code:error?.code||null,message:error?.message||String(error),requestId:error?.requestId||null});
  if(!res.headersSent)res.status(502).json({error:'Checkout carta temporaneamente non disponibile. Nessun addebito effettuato.',detail:process.env.NODE_ENV==='production'?undefined:error?.message});
 }
});
// AIRJOTTER_STRIPE_LIFECYCLE_1967
app.get('/api/billing/stripe/session/:id',auth,async(req,res)=>{
 try{
  if(!stripe)return res.status(503).json({error:'Stripe non configurato'});
  const id=String(req.params.id||'');if(!id.startsWith('cs_'))return res.status(400).json({error:'Sessione Stripe non valida'});
  const session=await stripe.checkout.sessions.retrieve(id,{expand:['subscription','line_items']});
  if(String(session.client_reference_id||'')!==String(req.user.sub))return res.status(403).json({error:'Sessione Stripe non associata a questo account'});
  const result=await reconcileStripeCheckoutSession(session,req.user.sub);
  res.json({ok:true,...result});
 }catch(e){console.error('Conferma Stripe 19.67:',e);res.status(500).json({error:e.message||'Conferma Stripe non riuscita'})}
});
app.post('/api/billing/stripe/upgrade',auth,async(req,res)=>{
 try{
  if(!stripe)return res.status(503).json({error:'Stripe non configurato'});
  const target=await planById(req.body.planId),u=(await pool.query('SELECT plan_code,subscription_provider,subscription_external_id,subscription_current_period_end,billing_customer_id,email FROM users WHERE id=$1',[req.user.sub])).rows[0]||{};
  if(!target||target.code!=='ultra'||u.plan_code!=='plus')return res.status(409).json({error:'Upgrade Stripe non applicabile a questo account'});
  const plusPlan=(await pool.query("SELECT stripe_price_id FROM billing_plans WHERE code='plus' LIMIT 1")).rows[0];
  let subscriptionId=String(u.subscription_external_id||'');
  let sub=null;
  if(subscriptionId.startsWith('sub_')){try{sub=await stripe.subscriptions.retrieve(subscriptionId,{expand:['items.data.price','schedule']})}catch(e){if(e?.code!=='resource_missing')throw e}}
  if(!sub){
   let customerId=String(u.billing_customer_id||'');
   if(!customerId.startsWith('cus_')){
    const customers=await stripe.customers.list({email:u.email,limit:10});
    customerId=customers.data[0]?.id||'';
   }
   if(customerId){
    const list=await stripe.subscriptions.list({customer:customerId,status:'all',limit:100,expand:['data.items.data.price','data.schedule']});
    sub=list.data.find(x=>['active','trialing','past_due'].includes(x.status)&&x.items.data.some(y=>(typeof y.price==='string'?y.price:y.price?.id)===plusPlan?.stripe_price_id))||null;
   }
  }
  if(!sub)return res.status(409).json({error:'Sottoscrizione Stripe Plus attiva non trovata'});
  subscriptionId=sub.id;
  const customerId=typeof sub.customer==='string'?sub.customer:sub.customer?.id;
  await pool.query("UPDATE users SET subscription_provider='stripe',subscription_external_id=$1,billing_customer_id=COALESCE($2,billing_customer_id),subscription_status=CASE WHEN subscription_status IS NULL OR subscription_status='' THEN 'active' ELSE subscription_status END WHERE id=$3",[subscriptionId,customerId||null,req.user.sub]);
  const start=Math.floor(Date.now()/1000),periodEnd=Math.floor((new Date(u.subscription_current_period_end||stripePeriodEnd(sub)||Date.now()+30*86400000)).getTime()/1000);
  let scheduleId=typeof sub.schedule==='string'?sub.schedule:sub.schedule?.id;
  if(!scheduleId){const created=await stripe.subscriptionSchedules.create({from_subscription:sub.id});scheduleId=created.id}
  const schedule=await stripe.subscriptionSchedules.retrieve(scheduleId);
  const currentStart=Number(schedule.current_phase?.start_date||start),currentEnd=Number(schedule.current_phase?.end_date||periodEnd);
  const currentItems=sub.items.data.map(x=>({price:typeof x.price==='string'?x.price:x.price.id,quantity:x.quantity||1}));
  await stripe.subscriptionSchedules.update(scheduleId,{end_behavior:'release',metadata:{airjotterUserId:req.user.sub,airjotterTargetPlanId:target.id,airjotterUpgrade:'plus-to-ultra-next-cycle'},phases:[{start_date:currentStart,end_date:currentEnd,items:currentItems,proration_behavior:'none'},{start_date:currentEnd,iterations:1,items:[{price:target.stripe_price_id,quantity:1}],proration_behavior:'none',metadata:{airjotterUserId:req.user.sub,airjotterPlanId:target.id}}]});
  await pool.query("INSERT INTO billing_orders(id,user_id,plan_id,provider,kind,external_id,status,amount_cents,currency,quantity,raw) VALUES($1,$2,$3,'stripe','subscription',$4,'approved_next_cycle',$5,$6,1,$7) ON CONFLICT DO NOTHING",[crypto.randomUUID(),req.user.sub,target.id,scheduleId,target.amount_cents,target.currency,JSON.stringify({subscriptionId:sub.id,effectiveAt:new Date(currentEnd*1000).toISOString()})]);
  res.json({ok:true,scheduled:true,plan:{code:target.code,name:target.name},effectiveAt:new Date(currentEnd*1000).toISOString(),amountCents:Number(target.amount_cents)});
 }catch(e){console.error('Upgrade Stripe 19.67:',e);res.status(500).json({error:e.message||'Programmazione upgrade Stripe non riuscita'})}
});
app.post('/api/billing/manage',auth,async(req,res)=>{
 try{
  const u=(await pool.query('SELECT subscription_provider,subscription_external_id,billing_customer_id FROM users WHERE id=$1',[req.user.sub])).rows[0]||{};
  if(u.subscription_provider==='stripe'){
   if(!stripe)return res.status(503).json({error:'Stripe non configurato'});
   let customer=u.billing_customer_id;
   if(!customer&&u.subscription_external_id){const sub=await stripe.subscriptions.retrieve(u.subscription_external_id);customer=typeof sub.customer==='string'?sub.customer:sub.customer?.id}
   if(!customer)return res.status(409).json({error:'Cliente Stripe non associato'});
   const portal=await stripe.billingPortal.sessions.create({customer,return_url:appBaseUrl+'/?billing=manage-return'});
   return res.json({url:portal.url,provider:'stripe'});
  }
  if(u.subscription_provider==='paypal')return res.json({url:process.env.PAYPAL_ENV==='live'?'https://www.paypal.com/myaccount/autopay/':'https://www.sandbox.paypal.com/myaccount/autopay/',provider:'paypal'});
  res.status(409).json({error:'Nessun abbonamento ricorrente da gestire'});
 }catch(e){console.error('Gestione abbonamento 19.67:',e);res.status(500).json({error:e.message||'Gestione abbonamento non disponibile'})}
});
app.post('/api/billing/paypal/create',auth,async(req,res)=>{let plan=await planById(req.body.planId);if(!plan||plan.status!=='active'||!plan.public)return res.sendStatus(404);const authp=await paypalToken();if(!authp)return res.status(503).json({error:'PayPal non configurato'});const quantity=plan.billing_type==='per_seat'?Math.max(Number(plan.min_seats||1),Number(req.body.quantity||1)):Math.max(1,Number(req.body.quantity||1));const currentBilling=(await pool.query('SELECT plan_code,subscription_provider,subscription_external_id FROM users WHERE id=$1',[req.user.sub])).rows[0]||{};const upgradeFromSubscriptionId=plan.code==='ultra'&&currentBilling.plan_code==='plus'&&currentBilling.subscription_provider==='paypal'&&/^I-[A-Z0-9]+$/i.test(String(currentBilling.subscription_external_id||''))?String(currentBilling.subscription_external_id):null;if(upgradeFromSubscriptionId){const currentPlan=(await pool.query("SELECT bp.* FROM users u JOIN billing_plans bp ON bp.id=u.plan_id OR (u.plan_id IS NULL AND bp.code=u.plan_code) WHERE u.id=$1 ORDER BY (bp.id=u.plan_id) DESC LIMIT 1",[req.user.sub])).rows[0];if(!currentPlan?.paypal_product_id)return res.status(409).json({error:'Piano Plus PayPal privo di prodotto associato.'});if(currentPlan.paypal_product_id!==plan.paypal_product_id){const compatible=await provisionPayPal({...plan,paypal_product_id:currentPlan.paypal_product_id,paypal_plan_id:null});plan=(await pool.query('UPDATE billing_plans SET paypal_product_id=$1,paypal_plan_id=$2,updated_at=now() WHERE id=$3 RETURNING *',[currentPlan.paypal_product_id,compatible.paypal_plan_id,plan.id])).rows[0]}const r=await fetch(authp.base+'/v1/billing/subscriptions/'+encodeURIComponent(upgradeFromSubscriptionId)+'/revise',{method:'POST',headers:{Authorization:'Bearer '+authp.token,'Content-Type':'application/json'},body:JSON.stringify({plan_id:plan.paypal_plan_id,application_context:{return_url:appBaseUrl+'/?billing=paypal-return&subscription_id='+encodeURIComponent(upgradeFromSubscriptionId),cancel_url:appBaseUrl+'/?billing=cancel',user_action:'CONTINUE'}})});const revised=await r.json().catch(()=>({}));if(!r.ok){const detail={httpStatus:r.status,name:revised.name||null,message:revised.message||null,issue:revised.details?.[0]?.issue||null,description:revised.details?.[0]?.description||null,field:revised.details?.[0]?.field||null,debugId:revised.debug_id||null,subscriptionId:upgradeFromSubscriptionId,planId:plan.paypal_plan_id};console.error('AIRJOTTER_PAYPAL_REVISE_DIAGNOSTIC_1964F',detail);return res.status(502).json({error:detail.description||detail.message||detail.issue||'Upgrade PayPal non disponibile',paypal:detail})}/* AIRJOTTER_PAYPAL_UPGRADE_ORDER_1964G: la sottoscrizione PayPal ha un solo external_id; aggiorna il suo ordine invece di inserirne un duplicato. */await pool.query("UPDATE billing_orders SET plan_id=$1,status='pending_cycle_upgrade',amount_cents=$2,currency=$3,raw=$4,updated_at=now() WHERE external_id=$5 AND user_id=$6 AND provider='paypal' AND kind='subscription'",[plan.id,plan.amount_cents,plan.currency,JSON.stringify({airjotterUpgrade:'plus-to-ultra-next-cycle',upgradeFromSubscriptionId}),upgradeFromSubscriptionId,req.user.sub]);return res.json({id:upgradeFromSubscriptionId,url:revised.links?.find(x=>x.rel==='approve')?.href,upgrade:'plus-to-ultra-next-cycle'})}if(plan.billing_type==='consumable'){const r=await fetch(authp.base+'/v2/checkout/orders',{method:'POST',headers:{Authorization:'Bearer '+authp.token,'Content-Type':'application/json','PayPal-Request-Id':crypto.randomUUID()},body:JSON.stringify({intent:'CAPTURE',purchase_units:[{custom_id:req.user.sub+'|'+plan.id,amount:{currency_code:plan.currency,value:((plan.amount_cents*quantity)/100).toFixed(2)}}],application_context:{return_url:appBaseUrl+'/?billing=paypal-return',cancel_url:appBaseUrl+'/?billing=cancel'}})});const order=await r.json();if(!r.ok)return res.status(502).json({error:order.message||'PayPal non disponibile'});await pool.query('INSERT INTO billing_orders(id,user_id,plan_id,provider,kind,external_id,status,amount_cents,currency,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[crypto.randomUUID(),req.user.sub,plan.id,'paypal','one_time',order.id,'pending',plan.amount_cents,plan.currency,quantity]);return res.json({id:order.id,url:order.links?.find(x=>x.rel==='approve')?.href})}if(!plan.paypal_plan_id)return res.status(400).json({error:'Piano PayPal non ancora configurato'});const r=await fetch(authp.base+'/v1/billing/subscriptions',{method:'POST',headers:{Authorization:'Bearer '+authp.token,'Content-Type':'application/json','PayPal-Request-Id':crypto.randomUUID()},body:JSON.stringify({plan_id:plan.paypal_plan_id,quantity:String(quantity),custom_id:req.user.sub+'|'+plan.id,application_context:{return_url:appBaseUrl+'/?billing=paypal-return',cancel_url:appBaseUrl+'/?billing=cancel',user_action:'SUBSCRIBE_NOW'}})});const sub=await r.json();if(!r.ok)return res.status(502).json({error:sub.message||'PayPal non disponibile'});await pool.query('INSERT INTO billing_orders(id,user_id,plan_id,provider,kind,external_id,status,amount_cents,currency,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[crypto.randomUUID(),req.user.sub,plan.id,'paypal','subscription',sub.id,'pending',plan.amount_cents,plan.currency,quantity]);res.json({id:sub.id,url:sub.links?.find(x=>x.rel==='approve')?.href})});

// AIRJOTTER_PAYPAL_REVISE_1964B
// AIRJOTTER_PAYPAL_REVISE_1964
// AIRJOTTER_PAYPAL_CONFIRM_V1960: conferma server-side del ritorno abbonamento.
app.post('/api/billing/paypal/subscription/confirm',auth,async(req,res)=>{
 const subscriptionId=String(req.body.subscriptionId||'').trim();if(!/^I-[A-Z0-9]+$/i.test(subscriptionId))return res.status(400).json({error:'Identificativo abbonamento PayPal non valido'});
 const authp=await paypalToken();if(!authp)return res.status(503).json({error:'PayPal non configurato'});
 const rr=await fetch(authp.base+'/v1/billing/subscriptions/'+encodeURIComponent(subscriptionId),{headers:{Authorization:'Bearer '+authp.token,'Content-Type':'application/json'}}),sub=await rr.json().catch(()=>({}));
 if(!rr.ok)return res.status(502).json({error:sub.message||'Verifica abbonamento PayPal non riuscita'});if(sub.status!=='ACTIVE')return res.status(409).json({error:'Abbonamento PayPal non ancora attivo',status:sub.status});
 const order=(await pool.query("SELECT * FROM billing_orders WHERE external_id=$1 AND user_id=$2 AND provider='paypal' AND kind='subscription' ORDER BY created_at DESC LIMIT 1",[subscriptionId,req.user.sub])).rows[0];if(!order)return res.status(404).json({error:'Abbonamento non associato a questo account AirJotter'});
 const plan=await planById(order.plan_id);if(!plan||sub.plan_id!==plan.paypal_plan_id)return res.status(409).json({error:'Il piano PayPal non corrisponde al piano AirJotter richiesto'});
 const expected=req.user.sub+'|'+plan.id;const scheduledUpgrade=order.status==='pending_cycle_upgrade';/* AIRJOTTER_PAYPAL_REVISE_ASSOC_1964H: durante revise PayPal conserva il custom_id originario Plus. L'ordine locale, gia vincolato a utente e subscription ID, e la fonte autorevole. */if(!scheduledUpgrade&&sub.custom_id&&sub.custom_id!==expected)return res.status(409).json({error:'Associazione PayPal non valida'});
 // AIRJOTTER_PAYPAL_REVISE_1964
 const scheduled=scheduledUpgrade;if(scheduled){await pool.query("UPDATE billing_orders SET status='approved_next_cycle',raw=$1,updated_at=now() WHERE id=$2",[sub,order.id]);return res.json({ok:true,scheduled:true,plan:{code:plan.code,name:plan.name},subscriptionId})}
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.sub+':paypal-subscription']);const current=(await c.query('SELECT subscription_external_id,plan_code FROM users WHERE id=$1 FOR UPDATE',[req.user.sub])).rows[0];if(current?.subscription_external_id!==subscriptionId||current?.plan_code!==plan.code)await applyPlanAndExtendExtras(c,req.user.sub,plan,'paypal',subscriptionId);await c.query("UPDATE users SET paypal_payer_id=COALESCE($1,paypal_payer_id),subscription_status='active' WHERE id=$2",[sub.subscriber?.payer_id||null,req.user.sub]);await c.query("UPDATE billing_orders SET status='paid',raw=$1,updated_at=now() WHERE id=$2",[sub,order.id]);await c.query('COMMIT');res.json({ok:true,status:sub.status,plan:{code:plan.code,name:plan.name},subscriptionId})}catch(e){await c.query('ROLLBACK');console.error('Conferma abbonamento PayPal:',e);res.status(500).json({error:'Abbonamento pagato ma attivazione AirJotter non completata'})}finally{c.release()}
});

app.post('/api/billing/paypal/capture',auth,async(req,res)=>{const authp=await paypalToken();if(!authp)return res.status(503).json({error:'PayPal non configurato'});const order=(await pool.query("SELECT * FROM billing_orders WHERE external_id=$1 AND user_id=$2 AND provider='paypal' FOR UPDATE",[req.body.orderId,req.user.sub])).rows[0];if(!order)return res.sendStatus(404);const plan=await planById(order.plan_id);if(order.kind==='one_time'){const r=await fetch(authp.base+'/v2/checkout/orders/'+order.external_id+'/capture',{method:'POST',headers:{Authorization:'Bearer '+authp.token,'Content-Type':'application/json','PayPal-Request-Id':crypto.randomUUID()}});const data=await r.json();if(!r.ok)return res.status(502).json({error:data.message||'Cattura PayPal non riuscita'});const c=await pool.connect();try{await c.query('BEGIN');await grantPurchase(c,req.user.sub,plan,'paypal',order.external_id,'active');await c.query("UPDATE billing_orders SET status='paid',raw=$1,updated_at=now() WHERE id=$2",[data,order.id]);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}return res.json({ok:true})}res.json({ok:true,pendingWebhook:true})});


async function payUseSettings(){return (await pool.query('SELECT * FROM pay_use_settings WHERE id=1')).rows[0]}
function payUsePublic(x){return {enabled:Boolean(x.enabled),currency:x.currency,minimumTopupCents:Number(x.minimum_topup_cents),jotterCostCents:Number(x.jotter_cost_cents),pageCostCents:Number(x.page_cost_cents),exportCostCents:Number(x.export_cost_cents)}}
app.get('/api/pay-use',auth,async(req,res)=>{const s=await payUseSettings(),u=(await pool.query('SELECT spot_credit_cents FROM users WHERE id=$1',[req.user.sub])).rows[0],tx=await pool.query(`SELECT t.transaction_type,t.amount_cents,t.item_type,t.units,t.provider,t.external_id,t.description,t.created_at,CASE WHEN t.transaction_type='spend' AND (t.item_type IN ('jotter','page') OR t.description~*'(jotter|pagine extra)') THEN COALESCE((SELECT max(e.expires_at) FROM user_extra_entitlements e WHERE e.user_id=t.user_id AND e.kind=CASE WHEN t.item_type IN ('jotter','page') THEN t.item_type WHEN t.description~*'pagine extra' THEN 'page' ELSE 'jotter' END AND e.purchase_request_id=t.external_id),t.created_at+interval '30 days') ELSE NULL END AS valid_until FROM pay_use_transactions t WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 50`,[req.user.sub]);res.json({...payUsePublic(s),balanceCents:Number(u?.spot_credit_cents||0),transactions:tx.rows})});
app.post('/api/pay-use/spend',auth,async(req,res)=>{const kind=String(req.body.kind||''),units=Math.max(1,Math.min(100,Number(req.body.units||1)));if(!['jotter','page','export'].includes(kind))return res.status(400).json({error:'Tipo di credito non valido'});if(kind==='page'&&!req.body.boardId)return res.status(400).json({error:'Seleziona il Jotter al quale assegnare le pagine extra'});const s=await payUseSettings();if(!s.enabled)return res.status(403).json({error:'Pay per Use non disponibile'});const cost={jotter:Number(s.jotter_cost_cents),page:Number(s.page_cost_cents),export:Number(s.export_cost_cents)}[kind],total=cost*units,c=await pool.connect();try{await c.query('BEGIN');const u=(await c.query('SELECT spot_credit_cents FROM users WHERE id=$1 FOR UPDATE',[req.user.sub])).rows[0];if(Number(u?.spot_credit_cents||0)<total){await c.query('ROLLBACK');return res.status(402).json({error:'Credito insufficiente. Puoi ricaricare il portafoglio oppure pagare direttamente.'})}await c.query('UPDATE users SET spot_credit_cents=spot_credit_cents-$1 WHERE id=$2',[total,req.user.sub]);if(kind==='export')await c.query('UPDATE users SET spot_exports=spot_exports+$1 WHERE id=$2',[units,req.user.sub]);else{for(let i=0;i<units;i++)await c.query("INSERT INTO user_extra_entitlements(id,user_id,kind,board_id,units,amount_cents,expires_at) VALUES($1,$2,$3,$4,1,$5,now()+interval '30 days')",[crypto.randomUUID(),req.user.sub,kind,kind==='page'?req.body.boardId:null,cost])}await c.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,units,description) VALUES($1,$2,'spend',$3,$4,$5,$6)",[crypto.randomUUID(),req.user.sub,-total,kind,units,`Acquisto ${units} ${kind}; validità 30 giorni`]);await c.query('COMMIT');res.json({ok:true,balanceCents:Number(u.spot_credit_cents)-total,kind,units,validDays:kind==='export'?null:30})}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}});

function planValidityDays(plan){return String(plan.interval_unit||'month')==='year'?365:Math.max(30,30*Number(plan.interval_count||1))}
async function applyPlanAndExtendExtras(client,userId,plan,provider,externalId){
 const old=await resolvedPlan(userId),days=planValidityDays(plan),periodEnd=new Date(Date.now()+days*86400000);
 const oldBoards=Number(old.boards||0),oldPages=Number(old.pages||0),newBoards=Number(plan.boards_limit||oldBoards),newPages=Number(plan.pages_limit||oldPages);
 const jotterCover=Math.max(0,newBoards-oldBoards),pageCover=Math.max(0,newPages-oldPages);
 await client.query('UPDATE users SET plan_id=$1,plan_code=$2,subscription_status=$3,subscription_provider=$4,subscription_external_id=$5,subscription_current_period_end=$6,plan_purchased_at=now() WHERE id=$7',[plan.id,plan.code,'active',provider,externalId,periodEnd,userId]);
 if(jotterCover>0){await client.query(`UPDATE user_extra_entitlements SET expires_at=$1,renewed_at=now() WHERE id IN (SELECT id FROM user_extra_entitlements WHERE user_id=$2 AND kind='jotter' AND expires_at>now() ORDER BY expires_at LIMIT $3)`,[periodEnd,userId,jotterCover])}
 if(pageCover>0){const boards=(await client.query('SELECT id FROM boards WHERE owner_user_id=$1',[userId])).rows;for(const b of boards){let left=pageCover;const extras=(await client.query("SELECT * FROM user_extra_entitlements WHERE user_id=$1 AND board_id=$2 AND kind='page' AND expires_at>now() ORDER BY expires_at FOR UPDATE",[userId,b.id])).rows;for(const e of extras){if(left<=0)break;const take=Math.min(left,Number(e.units));if(take===Number(e.units))await client.query('UPDATE user_extra_entitlements SET expires_at=$1,renewed_at=now() WHERE id=$2',[periodEnd,e.id]);else{await client.query('UPDATE user_extra_entitlements SET units=units-$1,page_from=CASE WHEN page_from IS NULL THEN NULL ELSE page_from+$1 END WHERE id=$2',[take,e.id]);await client.query("INSERT INTO user_extra_entitlements(id,user_id,kind,board_id,units,source,amount_cents,starts_at,expires_at,created_at,renewed_at,page_from,page_to,metadata) VALUES($1,$2,'page',$3,$4,$5,0,now(),$6,now(),now(),$7,$8,$9)",[crypto.randomUUID(),userId,b.id,take,e.source,periodEnd,e.page_from,e.page_from==null?null:Number(e.page_from)+take-1,JSON.stringify({absorbedByPlan:plan.code})])}left-=take}}}
 return {periodEnd,jotterExtended:jotterCover,pageExtendedPerJotter:pageCover,oldBoards,newBoards,oldPages,newPages};
}
app.get('/api/billing/credit/preview/:planId',auth,async(req,res)=>{const plan=await planById(req.params.planId);if(!plan||plan.status!=='active'||!plan.public||plan.billing_type==='free')return res.sendStatus(404);const u=(await pool.query('SELECT spot_credit_cents FROM users WHERE id=$1',[req.user.sub])).rows[0],old=await resolvedPlan(req.user.sub);const balance=Number(u?.spot_credit_cents||0),cost=Number(plan.amount_cents||0);res.json({plan:planPublic(plan),balanceCents:balance,costCents:cost,remainingCents:balance-cost,sufficient:balance>=cost,validDays:planValidityDays(plan),benefit:{jottersExtended:Math.max(0,Number(plan.boards_limit)-Number(old.boards)),pagesExtendedPerJotter:Math.max(0,Number(plan.pages_limit)-Number(old.pages))}})});
app.post('/api/billing/credit/activate',auth,async(req,res)=>{const plan=await planById(req.body.planId),requestId=String(req.body.requestId||'').slice(0,100);if(!plan||plan.status!=='active'||!plan.public||plan.billing_type==='free')return res.sendStatus(404);if(!requestId)return res.status(400).json({error:'Identificativo richiesta mancante'});const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.sub+':plan-credit']);const duplicate=await c.query("SELECT id FROM pay_use_transactions WHERE provider='wallet-plan' AND external_id=$1",[requestId]);if(duplicate.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Richiesta già elaborata'})}const u=(await c.query('SELECT spot_credit_cents FROM users WHERE id=$1 FOR UPDATE',[req.user.sub])).rows[0],cost=Number(plan.amount_cents||0),balance=Number(u?.spot_credit_cents||0);if(balance<cost){await c.query('ROLLBACK');const settings=await payUseSettings();return res.status(402).json({error:'Credito residuo insufficiente.',balanceCents:balance,costCents:cost,shortageCents:cost-balance,minimumTopupCents:Number(settings.minimum_topup_cents||300)})}await c.query('UPDATE users SET spot_credit_cents=spot_credit_cents-$1 WHERE id=$2',[cost,req.user.sub]);const benefit=await applyPlanAndExtendExtras(c,req.user.sub,plan,'wallet',requestId);await c.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,units,provider,external_id,description) VALUES($1,$2,'spend',$3,'plan',1,'wallet-plan',$4,$5)",[crypto.randomUUID(),req.user.sub,-cost,requestId,`Attivazione piano ${plan.name} con credito residuo`]);await c.query("INSERT INTO billing_orders(id,user_id,plan_id,provider,kind,external_id,status,amount_cents,currency,quantity,raw) VALUES($1,$2,$3,'admin','subscription',$4,'paid',$5,$6,1,$7)",[crypto.randomUUID(),req.user.sub,plan.id,'wallet:'+requestId,cost,plan.currency,JSON.stringify({paidWith:'wallet',benefit})]);await c.query('COMMIT');res.json({ok:true,balanceCents:balance-cost,plan:planPublic(plan),...benefit})}catch(e){await c.query('ROLLBACK');console.error('Attivazione piano con credito:',e);res.status(500).json({error:'Attivazione non completata. Nessun credito è stato scalato.'})}finally{c.release()}});
app.get('/api/pay-use/exports/quote',auth,async(req,res)=>{try{const settings=await payUseSettings(),u=(await pool.query('SELECT spot_credit_cents,spot_exports FROM users WHERE id=$1',[req.user.sub])).rows[0]||{},cost=Number(settings.export_cost_cents||0),balance=Number(u.spot_credit_cents||0);res.json({costCents:cost,balanceCents:balance,remainingCents:balance-cost,shortageCents:Math.max(0,cost-balance),sufficient:balance>=cost,availableExports:Number(u.spot_exports||0),currency:settings.currency||'EUR'})}catch(e){res.status(500).json({error:'Impossibile calcolare il costo dell’export.'})}});
app.post('/api/pay-use/exports/purchase',auth,async(req,res)=>{const requestId=String(req.body.requestId||'').trim().slice(0,100);if(!requestId)return res.status(400).json({error:'Identificativo richiesta mancante'});const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.sub+':pdf-export']);const dup=await c.query("SELECT id FROM pay_use_transactions WHERE provider='internal-export' AND external_id=$1",[requestId]);if(dup.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Richiesta già elaborata',duplicate:true})}const settings=(await c.query('SELECT * FROM pay_use_settings WHERE id=1')).rows[0];if(!settings?.enabled){await c.query('ROLLBACK');return res.status(403).json({error:'Pay per Use non disponibile'})}const u=(await c.query('SELECT spot_credit_cents FROM users WHERE id=$1 FOR UPDATE',[req.user.sub])).rows[0]||{},cost=Number(settings.export_cost_cents||0),balance=Number(u.spot_credit_cents||0);if(balance<cost){await c.query('ROLLBACK');return res.status(402).json({error:'Credito insufficiente.',balanceCents:balance,costCents:cost,shortageCents:cost-balance,currency:settings.currency||'EUR'})}await c.query('UPDATE users SET spot_credit_cents=spot_credit_cents-$1,spot_exports=spot_exports+1 WHERE id=$2',[cost,req.user.sub]);await c.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,units,provider,external_id,description) VALUES($1,$2,'spend',$3,'export',1,'internal-export',$4,'Acquisto di 1 export PDF completo')",[crypto.randomUUID(),req.user.sub,-cost,requestId]);await c.query('COMMIT');res.json({ok:true,balanceCents:balance-cost,costCents:cost,availableExports:1,currency:settings.currency||'EUR'})}catch(e){try{await c.query('ROLLBACK')}catch{};console.error('Acquisto export PDF:',e);res.status(500).json({error:'Acquisto non completato. Nessun credito è stato scalato.'})}finally{c.release()}});
app.post('/api/exports/authorize' ,auth,async(req,res)=>{const p=await resolvedPlan(req.user.sub);if(String(p.code).toLowerCase()!=='free'||String(req.user.email||'').toLowerCase()===ADMIN_EMAIL)return res.json({ok:true,full:true,paid:false,freePdfPages:null});const c=await pool.connect();try{await c.query('BEGIN');const u=(await c.query('SELECT spot_exports FROM users WHERE id=$1 FOR UPDATE',[req.user.sub])).rows[0];if(Number(u?.spot_exports||0)<1){const s=await payUseSettings();await c.query('ROLLBACK');return res.status(402).json({error:'Per esportare tutte le pagine acquista un export completo al costo di '+(Number(s.export_cost_cents)/100).toFixed(2)+' €.',costCents:Number(s.export_cost_cents)})}await c.query('UPDATE users SET spot_exports=spot_exports-1 WHERE id=$1',[req.user.sub]);await c.query('COMMIT');res.json({ok:true,full:true,paid:true})}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}});
app.post('/api/pay-use/stripe/topup',auth,async(req,res)=>{
 try{
  if(!stripe)return res.status(503).json({error:'Stripe non configurato'});
  const settings=await payUseSettings(),amount=Math.round(Number(req.body.amountCents||0));
  if(amount<Number(settings.minimum_topup_cents))return res.status(400).json({error:'La ricarica minima è '+(Number(settings.minimum_topup_cents)/100).toFixed(2)+' €'});
  const session=await stripe.checkout.sessions.create({
   mode:'payment',
   managed_payments:{enabled:false},
   line_items:[{price_data:{currency:settings.currency.toLowerCase(),unit_amount:amount,product_data:{name:'Credito AirJotter Pay per Use'}},quantity:1}],
   client_reference_id:req.user.sub,
   customer_email:req.user.email,
   success_url:appBaseUrl+'/?billing=stripe-credit-success&session_id={CHECKOUT_SESSION_ID}',
   cancel_url:appBaseUrl+'/?billing=cancel',
   metadata:{kind:'credit_topup',amountCents:String(amount)}
  });
  await pool.query("INSERT INTO billing_orders(id,user_id,provider,kind,external_id,status,amount_cents,currency,quantity) VALUES($1,$2,'stripe','one_time',$3,'pending',$4,$5,1)",[crypto.randomUUID(),req.user.sub,session.id,amount,settings.currency]);
  res.json({url:session.url});
 }catch(error){
  console.error('Stripe ricarica 19.66C:',{type:error?.type||null,code:error?.code||null,message:error?.message||String(error),requestId:error?.requestId||null});
  if(!res.headersSent)res.status(502).json({error:'Ricarica con carta temporaneamente non disponibile. Nessun addebito effettuato.',detail:process.env.NODE_ENV==='production'?undefined:error?.message});
 }
});
app.post('/api/pay-use/paypal/topup',auth,async(req,res)=>{const authp=await paypalToken();if(!authp)return res.status(503).json({error:'PayPal non configurato'});const s=await payUseSettings(),amount=Math.round(Number(req.body.amountCents||0));if(amount<Number(s.minimum_topup_cents))return res.status(400).json({error:'La ricarica minima è '+(Number(s.minimum_topup_cents)/100).toFixed(2)+' €'});const id=crypto.randomUUID();const r=await fetch(authp.base+'/v2/checkout/orders',{method:'POST',headers:{Authorization:'Bearer '+authp.token,'Content-Type':'application/json','PayPal-Request-Id':id},body:JSON.stringify({intent:'CAPTURE',purchase_units:[{custom_id:req.user.sub+'|credit|'+amount,description:'Credito AirJotter Pay per Use',amount:{currency_code:s.currency,value:(amount/100).toFixed(2)}}],application_context:{return_url:appBaseUrl+'/?billing=paypal-credit-return',cancel_url:appBaseUrl+'/?billing=cancel'}})});const order=await r.json();if(!r.ok)return res.status(502).json({error:order.message||'PayPal non disponibile'});await pool.query("INSERT INTO billing_orders(id,user_id,provider,kind,external_id,status,amount_cents,currency,quantity,raw) VALUES($1,$2,'paypal','one_time',$3,'pending',$4,$5,1,$6)",[id,req.user.sub,order.id,amount,s.currency,JSON.stringify({payUseTopup:true})]);res.json({id:order.id,url:order.links?.find(x=>x.rel==='approve')?.href})});
// AIRJOTTER_PAYPAL_CREDIT_CAPTURE_1960C
app.post('/api/billing/paypal/credit/capture',auth,async(req,res)=>{
 const authp=await paypalToken();if(!authp)return res.status(503).json({error:'PayPal non configurato'});
 const orderId=String(req.body.orderId||'').trim();if(!orderId)return res.status(400).json({error:'Ordine PayPal mancante'});
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.sub+':paypal-credit:'+orderId]);
  const order=(await c.query("SELECT * FROM billing_orders WHERE external_id=$1 AND user_id=$2 AND provider='paypal' AND kind='one_time' FOR UPDATE",[orderId,req.user.sub])).rows[0];if(!order){await c.query('ROLLBACK');return res.status(404).json({error:'Ricarica PayPal non associata a questo account'})}
  if(order.status==='paid'){await c.query('ROLLBACK');return res.json({ok:true,duplicate:true,balanceCents:Number((await pool.query('SELECT spot_credit_cents FROM users WHERE id=$1',[req.user.sub])).rows[0]?.spot_credit_cents||0)})}
  let rr=await fetch(authp.base+'/v2/checkout/orders/'+encodeURIComponent(orderId)+'/capture',{method:'POST',headers:{Authorization:'Bearer '+authp.token,'Content-Type':'application/json','PayPal-Request-Id':'airjotter-credit-'+orderId}}),data=await rr.json().catch(()=>({}));
  if(!rr.ok){const issue=data?.details?.[0]?.issue;if(issue!=='ORDER_ALREADY_CAPTURED'){await c.query('ROLLBACK');return res.status(502).json({error:data?.details?.[0]?.description||data.message||'Cattura PayPal non riuscita',paypalIssue:issue||null})}}
  // AIRJOTTER_PAYPAL_CREDIT_DETAILS_1960D_FIXED: rilettura obbligatoria della rappresentazione completa.
  rr=await fetch(authp.base+'/v2/checkout/orders/'+encodeURIComponent(orderId),{headers:{Authorization:'Bearer '+authp.token,'Content-Type':'application/json'}});data=await rr.json().catch(()=>({}));
  if(!rr.ok||data.status!=='COMPLETED'){await c.query('ROLLBACK');return res.status(409).json({error:'Pagamento PayPal non ancora completato',status:data.status||null})}
  const unit=data.purchase_units?.[0],expected=Number(order.amount_cents),paid=Math.round(Number(unit?.payments?.captures?.[0]?.amount?.value||unit?.amount?.value||0)*100),custom=String(unit?.custom_id||'');if(paid!==expected||custom!==req.user.sub+'|credit|'+expected){await c.query('ROLLBACK');return res.status(409).json({error:'Importo o intestazione della ricarica PayPal non corrispondenti'})}
  // AIRJOTTER_PAYPAL_CREDIT_IDEMPOTENCY_1960E: idempotenza senza dipendere da un indice UNIQUE assente.
  const ins=await c.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,provider,external_id,description) SELECT $1,$2,'topup',$3,'credit','paypal',$4,'Ricarica credito con PayPal' WHERE NOT EXISTS (SELECT 1 FROM pay_use_transactions WHERE provider='paypal' AND external_id=$4) RETURNING id",[crypto.randomUUID(),req.user.sub,expected,orderId]);if(ins.rowCount)await c.query('UPDATE users SET spot_credit_cents=spot_credit_cents+$1 WHERE id=$2',[expected,req.user.sub]);await c.query("UPDATE billing_orders SET status='paid',raw=$1,updated_at=now() WHERE id=$2",[data,order.id]);const balance=Number((await c.query('SELECT spot_credit_cents FROM users WHERE id=$1',[req.user.sub])).rows[0]?.spot_credit_cents||0);await c.query('COMMIT');res.json({ok:true,duplicate:!ins.rowCount,balanceCents:balance,creditedCents:ins.rowCount?expected:0})
 }catch(e){try{await c.query('ROLLBACK')}catch{};console.error('Acquisizione credito PayPal 19.60C:',e);res.status(500).json({error:'Ricarica pagata ma accredito AirJotter non completato'})}finally{c.release()}
});
app.post('/api/pay-use/paypal/capture',auth,async(req,res)=>{const authp=await paypalToken();if(!authp)return res.status(503).json({error:'PayPal non configurato'});const c=await pool.connect();try{await c.query('BEGIN');const order=(await c.query("SELECT * FROM billing_orders WHERE external_id=$1 AND user_id=$2 AND provider='paypal' FOR UPDATE",[req.body.orderId,req.user.sub])).rows[0];if(!order)return res.sendStatus(404);if(order.status==='paid'){await c.query('ROLLBACK');return res.json({ok:true,duplicate:true})}const rr=await fetch(authp.base+'/v2/checkout/orders/'+order.external_id+'/capture',{method:'POST',headers:{Authorization:'Bearer '+authp.token,'Content-Type':'application/json','PayPal-Request-Id':crypto.randomUUID()}}),data=await rr.json();if(!rr.ok){await c.query('ROLLBACK');return res.status(502).json({error:data.message||'Cattura PayPal non riuscita'})}const ins=await c.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,provider,external_id,description) VALUES($1,$2,'topup',$3,'credit','paypal',$4,'Ricarica credito con PayPal') ON CONFLICT(provider,external_id) DO NOTHING RETURNING id",[crypto.randomUUID(),req.user.sub,Number(order.amount_cents),order.external_id]);if(ins.rowCount)await c.query('UPDATE users SET spot_credit_cents=spot_credit_cents+$1 WHERE id=$2',[Number(order.amount_cents),req.user.sub]);await c.query("UPDATE billing_orders SET status='paid',raw=$1,updated_at=now() WHERE id=$2",[data,order.id]);await c.query('COMMIT');res.json({ok:true})}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}});
app.get('/api/admin/pay-use',auth,adminOnly,async(req,res)=>res.json(payUsePublic(await payUseSettings())));
app.patch('/api/admin/pay-use',auth,adminOnly,async(req,res)=>{const b=req.body,q=await pool.query('UPDATE pay_use_settings SET enabled=COALESCE($1,enabled),currency=COALESCE($2,currency),minimum_topup_cents=COALESCE($3,minimum_topup_cents),jotter_cost_cents=COALESCE($4,jotter_cost_cents),page_cost_cents=COALESCE($5,page_cost_cents),export_cost_cents=COALESCE($6,export_cost_cents),updated_at=now() WHERE id=1 RETURNING *',[b.enabled??null,b.currency?.toUpperCase()??null,b.minimumTopupCents??null,b.jotterCostCents??null,b.pageCostCents??null,b.exportCostCents??null]);res.json(payUsePublic(q.rows[0]))});
// AIRJOTTER_PLAN_NOTES_PERSISTENCE_V2304T
app.get('/api/admin/plans',auth,adminOnly,async(req,res)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate');const q=await pool.query('SELECT * FROM billing_plans ORDER BY sort_order,name');res.json(q.rows.map(r=>({...planPublic(r),stripeProductId:r.stripe_product_id,stripePriceId:r.stripe_price_id,paypalProductId:r.paypal_product_id,paypalPlanId:r.paypal_plan_id})))});
app.post('/api/admin/plans',auth,adminOnly,async(req,res)=>{const b=req.body,id=crypto.randomUUID(),code=String(b.code||b.name||'plan').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50);const q=await pool.query(`INSERT INTO billing_plans(id,code,name,description,status,billing_type,currency,amount_cents,interval_unit,interval_count,min_seats,max_seats,boards_limit,pages_limit,guests_limit,exports_limit,history_days,included_spot_jotters,included_spot_pages,included_spot_exports,features,consumable_kind,consumable_units,sort_order,featured,public,notes_limit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING *`,[id,code,b.name,b.description||'',b.status||'draft',b.billingType||'subscription',(b.currency||'EUR').toUpperCase(),Number(b.amountCents||0),b.intervalUnit||null,Number(b.intervalCount||1),Number(b.minSeats||1),b.maxSeats||null,Number(b.limits?.boards||1),Number(b.limits?.pages||3),b.limits?.guests??null,b.limits?.exports??null,b.limits?.historyDays??null,Number(b.included?.jotters||0),Number(b.included?.pages||0),Number(b.included?.exports||0),JSON.stringify(b.features||[]),b.consumableKind||null,Number(b.consumableUnits||0),Number(b.sortOrder||0),Boolean(b.featured),b.public!==false,b.limits?.notes==null?10:Math.max(1,Number(b.limits.notes))]);let row=(await pool.query('SELECT * FROM billing_plans WHERE id=$1',[id])).rows[0];try{const remote={...(await provisionStripe(row)),...(await provisionPayPal(row))};if(Object.keys(remote).length){row=(await pool.query('UPDATE billing_plans SET stripe_product_id=COALESCE($1,stripe_product_id),stripe_price_id=COALESCE($2,stripe_price_id),paypal_product_id=COALESCE($3,paypal_product_id),paypal_plan_id=COALESCE($4,paypal_plan_id) WHERE id=$5 RETURNING *',[remote.stripe_product_id||null,remote.stripe_price_id||null,remote.paypal_product_id||null,remote.paypal_plan_id||null,id])).rows[0]}}catch(e){console.warn('Provisioning provider:',e.message)}res.status(201).json(planPublic(row))});
app.patch('/api/admin/plans/:id',auth,adminOnly,async(req,res)=>{const old=await planById(req.params.id);if(!old)return res.sendStatus(404);const b=req.body,priceChanged=b.amountCents!=null&&Number(b.amountCents)!==Number(old.amount_cents);const q=await pool.query(`UPDATE billing_plans SET name=COALESCE($1,name),description=COALESCE($2,description),status=COALESCE($3,status),billing_type=COALESCE($4,billing_type),currency=COALESCE($5,currency),amount_cents=COALESCE($6,amount_cents),interval_unit=COALESCE($7,interval_unit),interval_count=COALESCE($8,interval_count),min_seats=COALESCE($9,min_seats),max_seats=$10,boards_limit=COALESCE($11,boards_limit),pages_limit=COALESCE($12,pages_limit),notes_limit=COALESCE($26,notes_limit),guests_limit=$13,exports_limit=$14,history_days=$15,included_spot_jotters=COALESCE($16,included_spot_jotters),included_spot_pages=COALESCE($17,included_spot_pages),included_spot_exports=COALESCE($18,included_spot_exports),features=COALESCE($19,features),consumable_kind=$20,consumable_units=COALESCE($21,consumable_units),sort_order=COALESCE($22,sort_order),featured=COALESCE($23,featured),public=COALESCE($24,public),updated_at=now() WHERE id=$25 RETURNING *`,[b.name??null,b.description??null,b.status??null,b.billingType??null,b.currency?.toUpperCase()??null,b.amountCents??null,b.intervalUnit??null,b.intervalCount??null,b.minSeats??null,b.maxSeats??old.max_seats,b.limits?.boards??null,b.limits?.pages??null,b.limits?.guests??old.guests_limit,b.limits?.exports??old.exports_limit,b.limits?.historyDays??old.history_days,b.included?.jotters??null,b.included?.pages??null,b.included?.exports??null,b.features?JSON.stringify(b.features):null,b.consumableKind??old.consumable_kind,b.consumableUnits??null,b.sortOrder??null,b.featured??null,b.public??null,req.params.id,b.limits?.notes==null?null:Math.max(1,Number(b.limits.notes))]);let row=(await pool.query('SELECT * FROM billing_plans WHERE id=$1',[req.params.id])).rows[0];if(priceChanged){try{const remote={...(await provisionStripe({...row,stripe_price_id:null})),...(await provisionPayPal({...row,paypal_plan_id:null}))};row=(await pool.query('UPDATE billing_plans SET stripe_product_id=COALESCE($1,stripe_product_id),stripe_price_id=COALESCE($2,stripe_price_id),paypal_product_id=COALESCE($3,paypal_product_id),paypal_plan_id=COALESCE($4,paypal_plan_id) WHERE id=$5 RETURNING *',[remote.stripe_product_id||null,remote.stripe_price_id||null,remote.paypal_product_id||null,remote.paypal_plan_id||null,row.id])).rows[0]}catch(e){console.warn('Nuovo prezzo provider:',e.message)}}res.json(planPublic(row))});
app.delete('/api/admin/plans/:id',auth,adminOnly,async(req,res)=>{const used=Number((await pool.query('SELECT count(*) FROM users WHERE plan_id=$1',[req.params.id])).rows[0].count);if(used)return res.status(409).json({error:'Piano assegnato a utenti: archiviarlo invece di eliminarlo'});const q=await pool.query('DELETE FROM billing_plans WHERE id=$1 RETURNING id',[req.params.id]);if(!q.rowCount)return res.sendStatus(404);res.json({deleted:true})});
app.get('/api/admin/billing/orders',auth,adminOnly,async(req,res)=>{const q=await pool.query('SELECT o.*,u.email,p.name plan_name FROM billing_orders o JOIN users u ON u.id=o.user_id LEFT JOIN billing_plans p ON p.id=o.plan_id ORDER BY o.created_at DESC LIMIT 500');res.json(q.rows)});


app.get('/api/extras/me',auth,async(req,res)=>{const p=await resolvedPlan(req.user.sub),q=await pool.query(`SELECT e.id,e.kind,e.board_id,e.units,e.source,e.amount_cents,e.starts_at,e.expires_at,e.page_from,e.page_to,b.title,b.room_code,(e.expires_at<=now()) expired FROM user_extra_entitlements e LEFT JOIN boards b ON b.id=e.board_id WHERE e.user_id=$1 ORDER BY e.expires_at`,[req.user.sub]);res.json({plan:p,extras:q.rows})});
app.post('/api/extras/:id/renew',auth,async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const e=(await c.query('SELECT * FROM user_extra_entitlements WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.sub])).rows[0];if(!e){await c.query('ROLLBACK');return res.sendStatus(404)}const s=await payUseSettings(),unit=e.kind==='jotter'?Number(s.jotter_cost_cents):Number(s.page_cost_cents),total=unit*Number(e.units),u=(await c.query('SELECT spot_credit_cents FROM users WHERE id=$1 FOR UPDATE',[req.user.sub])).rows[0];if(Number(u.spot_credit_cents)<total){await c.query('ROLLBACK');return res.status(402).json({error:'Credito insufficiente per il rinnovo'})}const x=(await c.query("UPDATE user_extra_entitlements SET expires_at=GREATEST(expires_at,now())+interval '30 days',renewed_at=now() WHERE id=$1 RETURNING *",[e.id])).rows[0];await c.query('UPDATE users SET spot_credit_cents=spot_credit_cents-$1 WHERE id=$2',[total,req.user.sub]);await c.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,units,description) VALUES($1,$2,'spend',$3,$4,$5,'Rinnovo extra per ulteriori 30 giorni')",[crypto.randomUUID(),req.user.sub,-total,e.kind,e.units]);await c.query('COMMIT');res.json({ok:true,expiresAt:x.expires_at,balanceCents:Number(u.spot_credit_cents)-total})}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}});
app.post('/api/admin/users/:id/gift-credit',auth,adminOnly,async(req,res)=>{const cents=Math.round(Number(req.body.amountCents||0)),reason=String(req.body.reason||'').trim();if(cents<=0||!reason)return res.status(400).json({error:'Importo positivo e motivazione sono obbligatori'});const q=await pool.query('UPDATE users SET spot_credit_cents=spot_credit_cents+$1 WHERE id=$2 RETURNING spot_credit_cents',[cents,req.params.id]);if(!q.rowCount)return res.sendStatus(404);await pool.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,provider,description) VALUES($1,$2,'admin_adjustment',$3,'credit','admin',$4)",[crypto.randomUUID(),req.params.id,cents,'Credito omaggio: '+reason]);res.json({ok:true,balanceCents:Number(q.rows[0].spot_credit_cents)})});

// AIRJOTTER_V2280_EXTRA_PAGES_UX
async function currentBoardPageCount(client,boardId){
 const q=await client.query("SELECT operation_type,payload FROM board_operations WHERE board_id=$1 AND is_active=true AND operation_type IN ('page:set','page:delete','board:clear') ORDER BY revision",[boardId]);
 let pages=2;
 for(const op of q.rows){
  if(op.operation_type==='page:set')pages=Math.max(1,Number(op.payload?.count)||1);
  else if(op.operation_type==='page:delete')pages=Math.max(1,pages-1);
  else if(op.operation_type==='board:clear')pages=2;
 }
 return pages;
}
async function pagePurchaseQuote(userId,boardId,units){
 const board=(await pool.query('SELECT id,title,room_code,owner_user_id FROM boards WHERE id=$1',[boardId])).rows[0];
 if(!board)throw Object.assign(new Error('Jotter non trovato'),{status:404});
 if(board.owner_user_id!==userId)throw Object.assign(new Error('Le pagine extra possono essere acquistate soltanto dal proprietario del Jotter.'),{status:403});
 const settings=await payUseSettings();
 if(!settings?.enabled)throw Object.assign(new Error('Pay per Use non disponibile'),{status:403});
 const user=(await pool.query('SELECT spot_credit_cents FROM users WHERE id=$1',[userId])).rows[0];
 const plan=await resolvedPlan(userId);
 const activeExtraPages=Number((await pool.query("SELECT COALESCE(sum(units),0) n FROM user_extra_entitlements WHERE board_id=$1 AND kind='page' AND expires_at>now()",[boardId])).rows[0].n||0);
 const pageLimit=Number(plan.pages||0)+activeExtraPages;
 const temp=await pool.connect();
 let currentPages;
 try{currentPages=await currentBoardPageCount(temp,boardId)}finally{temp.release()}
 const count=Math.max(1,Math.min(100,Number(units)||1));
 const unitCostCents=Number(settings.page_cost_cents||0);
 const totalCostCents=unitCostCents*count;
 const now=new Date();
 const expiresAt=new Date(now.getTime()+30*86400000);
 // AIRJOTTER_EXTRA_PAGE_RANGE_LABEL_V2300W quote: gli extra iniziano dopo la capienza gia inclusa/attiva, non dopo le sole pagine fisicamente presenti.
 const entitlementBase=Math.max(currentPages,pageLimit),fromPage=entitlementBase+1,toPage=entitlementBase+count;
 return {boardId:board.id,boardTitle:board.title||'Jotter senza titolo',roomCode:board.room_code,units:count,currentPages,pageLimit,fromPage,toPage,unitCostCents,totalCostCents,balanceCents:Number(user?.spot_credit_cents||0),remainingCents:Number(user?.spot_credit_cents||0)-totalCostCents,expiresAt:expiresAt.toISOString(),currency:settings.currency||'EUR',sufficient:Number(user?.spot_credit_cents||0)>=totalCostCents};
}
app.get('/api/pay-use/pages/quote',auth,async(req,res)=>{try{res.json(await pagePurchaseQuote(req.user.sub,String(req.query.boardId||''),req.query.units))}catch(e){res.status(e.status||500).json({error:e.message||'Impossibile calcolare il preventivo'})}});
app.post('/api/pay-use/pages/purchase',auth,async(req,res)=>{
 const boardId=String(req.body.boardId||''),units=Math.max(1,Math.min(100,Number(req.body.units)||1)),requestId=String(req.body.requestId||'').trim().slice(0,100);
 if(!boardId)return res.status(400).json({error:'Seleziona il Jotter al quale assegnare le pagine extra'});
 if(!requestId)return res.status(400).json({error:'Identificativo richiesta mancante'});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.sub+':'+boardId]);
  const duplicate=await c.query("SELECT id FROM user_extra_entitlements WHERE purchase_request_id=$1 LIMIT 1",[requestId]);
  if(duplicate.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Questa richiesta è già stata elaborata.',duplicate:true})}
  const board=(await c.query('SELECT id,title,room_code,owner_user_id FROM boards WHERE id=$1 FOR UPDATE',[boardId])).rows[0];
  if(!board){await c.query('ROLLBACK');return res.status(404).json({error:'Jotter non trovato'})}
  if(board.owner_user_id!==req.user.sub){await c.query('ROLLBACK');return res.status(403).json({error:'Le pagine extra possono essere acquistate soltanto dal proprietario del Jotter.'})}
  const settings=(await c.query('SELECT * FROM pay_use_settings WHERE id=1')).rows[0];
  if(!settings?.enabled){await c.query('ROLLBACK');return res.status(403).json({error:'Pay per Use non disponibile'})}
  const user=(await c.query('SELECT spot_credit_cents FROM users WHERE id=$1 FOR UPDATE',[req.user.sub])).rows[0];
  const unitCostCents=Number(settings.page_cost_cents||0),totalCostCents=unitCostCents*units,balanceCents=Number(user?.spot_credit_cents||0);
  const currentPages=await currentBoardPageCount(c,boardId);
  const plan=await resolvedPlan(req.user.sub),activeExtraPages=Number((await c.query("SELECT COALESCE(sum(units),0) n FROM user_extra_entitlements WHERE board_id=$1 AND kind='page' AND expires_at>now()",[boardId])).rows[0].n||0),pageLimit=Number(plan.pages||0)+activeExtraPages;
  const entitlementBase=Math.max(currentPages,pageLimit),fromPage=entitlementBase+1,toPage=entitlementBase+units; // AIRJOTTER_EXTRA_PAGE_RANGE_LABEL_V2300W
  if(balanceCents<totalCostCents){await c.query('ROLLBACK');return res.status(402).json({error:'Credito insufficiente.',balanceCents,totalCostCents,shortageCents:totalCostCents-balanceCents,minimumTopupCents:Number(settings.minimum_topup_cents||300),currency:settings.currency||'EUR'})}
  const entitlementId=crypto.randomUUID();
  const ent=(await c.query("INSERT INTO user_extra_entitlements(id,user_id,kind,board_id,units,source,amount_cents,expires_at,page_from,page_to,purchase_request_id) VALUES($1,$2,'page',$3,$4,'purchase',$5,now()+interval '30 days',$6,$7,$8) RETURNING id,expires_at",[entitlementId,req.user.sub,boardId,units,totalCostCents,fromPage,toPage,requestId])).rows[0];
  await c.query('UPDATE users SET spot_credit_cents=spot_credit_cents-$1 WHERE id=$2',[totalCostCents,req.user.sub]);
  await c.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,units,provider,external_id,description) VALUES($1,$2,'spend',$3,'page',$4,'internal-pages',$5,$6)",[crypto.randomUUID(),req.user.sub,-totalCostCents,units,requestId,`Pagine extra ${fromPage}-${toPage} per ${board.title||'Jotter'}; validità 30 giorni`]);
  const rev=(await c.query('UPDATE boards SET revision=revision+1,updated_at=now(),content_updated_at=now() WHERE id=$1 RETURNING revision',[boardId])).rows[0].revision;
  const operationId=crypto.randomUUID();
  await c.query("INSERT INTO board_operations(board_id,revision,operation_id,user_id,operation_type,payload) VALUES($1,$2,$3,$4,'page:set',$5)",[boardId,rev,operationId,req.user.sub,{count:toPage}]);
  await c.query('COMMIT');
  const event={boardId,operationId,type:'page:set',payload:{count:toPage},revision:rev};
  io.to(`board:${boardId}`).emit('board:operation',event);
  res.json({ok:true,boardId,boardTitle:board.title||'Jotter senza titolo',units,fromPage,toPage,pageCount:toPage,unitCostCents,totalCostCents,balanceCents:balanceCents-totalCostCents,expiresAt:ent.expires_at,currency:settings.currency||'EUR'});
 }catch(e){try{await c.query('ROLLBACK')}catch{};console.error('Acquisto pagine extra:',e);res.status(500).json({error:'Acquisto non completato. Nessun credito è stato scalato.',detail:process.env.NODE_ENV==='production'?undefined:e.message})}finally{c.release()}
});


// AIRJOTTER_V2281_EXTRA_JOTTERS_AND_ADMIN_DETAIL
async function jotterQuote(userId,units){const settings=await payUseSettings(),u=(await pool.query('SELECT spot_credit_cents FROM users WHERE id=$1',[userId])).rows[0],p=await resolvedPlan(userId),owned=Number((await pool.query('SELECT count(*) n FROM boards WHERE owner_user_id=$1',[userId])).rows[0].n||0),activeExtra=Number((await pool.query("SELECT COALESCE(sum(units),0) n FROM user_extra_entitlements WHERE user_id=$1 AND kind='jotter' AND expires_at>now()",[userId])).rows[0].n||0),count=Math.max(1,Math.min(100,Number(units)||1)),unit=Number(settings.jotter_cost_cents||0),total=unit*count,balance=Number(u?.spot_credit_cents||0);return {units:count,baseJotters:Number(p.boards||0),ownedJotters:owned,activeExtraJotters:activeExtra,availableSlots:Math.max(0,Number(p.boards||0)+activeExtra-owned),unitCostCents:unit,totalCostCents:total,balanceCents:balance,remainingCents:balance-total,expiresAt:new Date(Date.now()+30*86400000).toISOString(),currency:settings.currency||'EUR',sufficient:balance>=total}}
app.get('/api/pay-use/jotters/quote',auth,async(req,res)=>{try{res.json(await jotterQuote(req.user.sub,req.query.units))}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/pay-use/jotters/purchase',auth,async(req,res)=>{const units=Math.max(1,Math.min(100,Number(req.body.units)||1)),requestId=String(req.body.requestId||'').trim().slice(0,100);if(!requestId)return res.status(400).json({error:'Identificativo richiesta mancante'});const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.sub+':jotter-extra']);const dup=await c.query("SELECT id FROM pay_use_transactions WHERE provider='internal-jotters' AND external_id=$1",[requestId]);if(dup.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Richiesta già elaborata'})}const settings=(await c.query('SELECT * FROM pay_use_settings WHERE id=1')).rows[0],u=(await c.query('SELECT spot_credit_cents FROM users WHERE id=$1 FOR UPDATE',[req.user.sub])).rows[0],unit=Number(settings.jotter_cost_cents||0),total=unit*units,balance=Number(u?.spot_credit_cents||0);if(balance<total){await c.query('ROLLBACK');return res.status(402).json({error:'Credito insufficiente.',balanceCents:balance,totalCostCents:total,shortageCents:total-balance,currency:settings.currency||'EUR'})}await c.query("INSERT INTO user_extra_entitlements(id,user_id,kind,board_id,units,source,amount_cents,expires_at,purchase_request_id) VALUES($1,$2,'jotter',NULL,$3,'purchase',$4,now()+interval '30 days',$5)",[crypto.randomUUID(),req.user.sub,units,total,requestId]);await c.query('UPDATE users SET spot_credit_cents=spot_credit_cents-$1 WHERE id=$2',[total,req.user.sub]);await c.query("INSERT INTO pay_use_transactions(id,user_id,transaction_type,amount_cents,item_type,units,provider,external_id,description) VALUES($1,$2,'spend',$3,'jotter',$4,'internal-jotters',$5,$6)",[crypto.randomUUID(),req.user.sub,-total,units,requestId,`Acquisto ${units} Jotter extra; validità 30 giorni`]);await c.query('COMMIT');res.json({ok:true,units,totalCostCents:total,balanceCents:balance-total,expiresAt:new Date(Date.now()+30*86400000).toISOString(),currency:settings.currency||'EUR'})}catch(e){try{await c.query('ROLLBACK')}catch{};console.error('Acquisto Jotter:',e);res.status(500).json({error:'Acquisto non completato. Nessun credito è stato scalato.'})}finally{c.release()}});
app.get('/api/admin/users/:id/jotter-detail',auth,adminOnly,async(req,res)=>{
 const u=(await pool.query(`SELECT u.id,u.email,u.display_name,u.plan_code,u.subscription_current_period_end,p.name plan_name,COALESCE(p.boards_limit,(CASE u.plan_code WHEN 'plus' THEN 5 WHEN 'ultra' THEN 20 WHEN 'unlimited' THEN 2147483647 ELSE 2 END)) boards_limit FROM users u LEFT JOIN billing_plans p ON p.id=u.plan_id WHERE u.id=$1`,[req.params.id])).rows[0];
 if(!u)return res.sendStatus(404);
 const boards=(await pool.query('SELECT id,title,room_code,created_at FROM boards WHERE owner_user_id=$1 ORDER BY created_at',[req.params.id])).rows;
 const jotterExtras=(await pool.query("SELECT id,expires_at,created_at FROM user_extra_entitlements WHERE user_id=$1 AND kind='jotter' ORDER BY created_at,expires_at",[req.params.id])).rows;
 const pageExtras=(await pool.query("SELECT id,board_id,units,page_from,page_to,expires_at,created_at FROM user_extra_entitlements WHERE user_id=$1 AND kind='page' ORDER BY created_at,expires_at",[req.params.id])).rows;
 const base=Number(u.boards_limit||0);
 res.json({user:{id:u.id,email:u.email,name:u.display_name,plan:u.plan_name||u.plan_code,nextRenewal:u.subscription_current_period_end,baseJotters:base},boards:boards.map((b,i)=>({id:b.id,title:b.title,roomCode:b.room_code,createdAt:b.created_at,jotterExpiresAt:i>=base?jotterExtras[i-base]?.expires_at||null:null,pageExtras:pageExtras.filter(x=>x.board_id===b.id).map(x=>({id:x.id,units:Number(x.units),pageFrom:x.page_from,pageTo:x.page_to,expiresAt:x.expires_at}))}))});
});
app.get('/privacy',(req,res)=>res.sendFile(path.join(process.cwd(),'public','privacy.html')));
app.get('/terms',(req,res)=>res.sendFile(path.join(process.cwd(),'public','terms.html')));
app.post('/api/boards/cleanup-empty',auth,async(req,res)=>{const deleted=await startupCleanup(req.user.sub);res.json({deleted})});
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.get('/api/config',(req,res)=>res.json({googleClientId:process.env.GOOGLE_CLIENT_ID||'',devAuth:process.env.DEV_AUTH==='true',firebaseEmailAuth:Boolean(firebaseAdminAuth)}));
app.post('/api/auth/google',async(req,res)=>{const client=await pool.connect();try{const t=await google.verifyIdToken({idToken:req.body.credential,audience:process.env.GOOGLE_CLIENT_ID});const p=t.getPayload();if(!p?.sub||!p?.email||p.email_verified!==true)return res.status(401).json({error:'Account Google senza email verificata'});const email=String(p.email).trim().toLowerCase(),existing=(await client.query('SELECT * FROM users WHERE lower(email)=lower($1)',[email])).rows[0],intent=String(req.body.intent||'login');if(!existing&&intent!=='register')return res.status(409).json({error:'Account AirJotter non trovato. Seleziona Registrati.'});const acceptance=legalAcceptance(req.body,'google');if(!existing&&!acceptance.valid)return res.status(400).json({error:'Per registrarti devi leggere l Informativa Privacy e accettare le Condizioni d uso.'});await client.query('BEGIN');const id=crypto.randomUUID();const q=await client.query(`INSERT INTO users(id,google_sub,email,display_name,avatar_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO UPDATE SET google_sub=EXCLUDED.google_sub,display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url RETURNING *`,[id,p.sub,email,p.name||email,p.picture||null]);const user=q.rows[0];if(!existing)await recordRegistrationAcceptance(client,user,email,acceptance);await client.query('UPDATE users SET last_login_at=now() WHERE id=$1',[user.id]);await client.query('INSERT INTO login_events(id,user_id) VALUES($1,$2)',[crypto.randomUUID(),user.id]);await client.query('COMMIT');res.cookie('aj_session',tokenFor(user,{authProvider:'google',googleSub:p.sub,emailVerified:true}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:604800000});res.json({ok:true,user})}catch(error){try{await client.query('ROLLBACK')}catch{};console.error('Verifica Google:',error.message);res.status(401).json({error:error.message||'Credenziale Google non valida'})}finally{client.release()}});
app.post('/api/auth/firebase',async(req,res)=>{const client=await pool.connect();try{if(!firebaseAdminAuth)return res.status(503).json({error:'Accesso email temporaneamente non disponibile'});const idToken=String(req.body.idToken||'');if(!idToken)return res.status(400).json({error:'Token Firebase mancante'});const decoded=await firebaseAdminAuth.verifyIdToken(idToken,true);const email=String(decoded.email||'').trim().toLowerCase();if(!decoded.uid||!email||decoded.email_verified!==true)return res.status(401).json({error:'Conferma prima il tuo indirizzo email'});const existing=(await client.query('SELECT * FROM users WHERE lower(email)=lower($1)',[email])).rows[0],acceptance=legalAcceptance(req.body,'email');if(!existing&&!acceptance.valid)return res.status(400).json({error:'Per completare la registrazione devi confermare Privacy e Condizioni d uso.'});const name=String(decoded.name||email.split('@')[0]).trim().slice(0,120)||email;await client.query('BEGIN');const id=crypto.randomUUID();const q=await client.query(`INSERT INTO users(id,email,display_name,avatar_url) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET display_name=COALESCE(NULLIF(EXCLUDED.display_name,''),users.display_name),avatar_url=COALESCE(EXCLUDED.avatar_url,users.avatar_url) RETURNING *`,[id,email,name,decoded.picture||null]);const user=q.rows[0];if(!existing)await recordRegistrationAcceptance(client,user,email,acceptance);if(user.is_suspended){await client.query('ROLLBACK');return res.status(403).json({error:'Account sospeso. Contatta il titolare di AirJotter.'})}await client.query('UPDATE users SET last_login_at=now() WHERE id=$1',[user.id]);await client.query('INSERT INTO login_events(id,user_id) VALUES($1,$2)',[crypto.randomUUID(),user.id]);await client.query('COMMIT');res.cookie('aj_session',tokenFor(user,{authProvider:'firebase',emailVerified:true}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:604800000});res.json({ok:true,user})}catch(error){try{await client.query('ROLLBACK')}catch{};console.error('Verifica Firebase:',error.message);res.status(401).json({error:error.message||'Credenziale email non valida o scaduta'})}finally{client.release()}});
app.post('/api/auth/dev',async(req,res)=>{try{if(process.env.DEV_AUTH!=='true')return res.status(404).json({error:'Accesso test disattivato'});const email=String(req.body.email||'demo@airjotter.local').trim().toLowerCase();const name=String(req.body.name||email.split('@')[0]).trim();if(!email||!name)return res.status(400).json({error:'Nome ed email sono obbligatori'});const id=crypto.randomUUID();const query=await pool.query(`INSERT INTO users(id,email,display_name) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING *`,[id,email,name]);const user=query.rows[0];if(user.is_suspended)return res.status(403).json({error:'Account sospeso. Contatta il titolare di AirJotter.'});if(user.is_suspended)return res.status(403).json({error:'Account sospeso. Contatta il titolare di AirJotter.'});try{await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1',[user.id]);await pool.query('INSERT INTO login_events(id,user_id) VALUES($1,$2)',[crypto.randomUUID(),user.id])}catch(metricError){console.warn('Metriche accesso non registrate:',metricError.message)}res.cookie('aj_session',tokenFor(user),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:604800000});res.json({ok:true,user})}catch(error){console.error('Errore accesso sviluppo:',error);res.status(500).json({error:'Accesso non riuscito: '+error.message})}});
app.get('/api/me',auth,async(req,res)=>{const isAdmin=String(req.user.email||'').toLowerCase()===ADMIN_EMAIL;if(isAdmin)await pool.query("UPDATE users SET plan_code='unlimited' WHERE id=$1",[req.user.sub]);const rp=await resolvedPlan(req.user.sub);res.json({...req.user,plan:rp.code,planName:rp.name,limits:{boards:rp.boards+rp.spotJotters,pages:rp.pages+rp.spotPages,freePdfPages:rp.freePdfPages},credits:{jotters:rp.spotJotters,pages:rp.spotPages,exports:rp.spotExports,balanceCents:rp.spotCreditCents||0},isAdmin})});
// AIRJOTTER_FILE_TRANSFER_LAUNCH_V2307B
app.post('/api/file-transfer/launch-board',auth,async(req,res)=>{
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.sub+':file-transfer-launch']);
  const rp=await resolvedPlan(req.user.sub),isOwner=String(req.user.email||'').toLowerCase()===ADMIN_EMAIL;
  const limit=isOwner?Number.MAX_SAFE_INTEGER:Number(rp.boards||0)+Number(rp.spotJotters||0);
  await c.query("UPDATE user_extra_entitlements e SET board_id=NULL FROM boards b WHERE e.board_id=b.id AND e.user_id=$1 AND e.kind='jotter' AND e.expires_at>now() AND b.owner_user_id=$1 AND b.is_empty=true AND b.is_current=false",[req.user.sub]);
  await c.query('DELETE FROM boards WHERE owner_user_id=$1 AND is_empty=true AND is_current=false',[req.user.sub]);
  const owned=await c.query('SELECT id,room_code,title,revision,content_updated_at FROM boards WHERE owner_user_id=$1 ORDER BY content_updated_at DESC,created_at DESC FOR UPDATE',[req.user.sub]);
  let board=null,created=false;
  if(owned.rowCount<limit){
   await c.query('UPDATE boards SET is_current=false WHERE owner_user_id=$1',[req.user.sub]);
   for(let i=0;i<12&&!board;i++){
    const id=crypto.randomUUID(),code=randomCode();
    const q=await c.query("INSERT INTO boards(id,room_code,owner_user_id,title,is_empty,is_current) VALUES($1,$2,$3,'File Transfer',true,true) ON CONFLICT DO NOTHING RETURNING id,room_code,title,revision",[id,code,req.user.sub]);
    if(q.rowCount){await c.query("INSERT INTO board_members(board_id,user_id,role,status) VALUES($1,$2,'owner','approved')",[id,req.user.sub]);board=q.rows[0];created=true}
   }
  }else board=owned.rows[0]||null;
  if(!board){await c.query('ROLLBACK');return res.status(409).json({error:'Nessun Jotter disponibile per il File Transfer.',code:'file_transfer_no_board',limit,owned:owned.rowCount})}
  await c.query('UPDATE boards SET is_current=false WHERE owner_user_id=$1 AND id<>$2',[req.user.sub,board.id]);
  await c.query('UPDATE boards SET is_current=true,empty_cleanup_after=NULL WHERE id=$1',[board.id]);
  await c.query('COMMIT');
  res.json({id:board.id,roomCode:board.room_code,title:board.title||'File Transfer',revision:Number(board.revision||0),role:'owner',ownerName:req.user.name,isCurrent:true,created,limit,owned:created?owned.rowCount+1:owned.rowCount});
 }catch(e){try{await c.query('ROLLBACK')}catch{};console.error('Avvio rapido File Transfer:',e);res.status(500).json({error:'Impossibile preparare il File Transfer'})}finally{c.release()}
});
app.post('/api/boards',auth,async(req,res)=>{const rp=await resolvedPlan(req.user.sub),plan=rp.code,isOwner=String(req.user.email||'').toLowerCase()===ADMIN_EMAIL,limit=isOwner?Number.MAX_SAFE_INTEGER:rp.boards+rp.spotJotters;for(let i=0;i<12;i++){const id=crypto.randomUUID(),code=randomCode(),c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.sub]);await c.query("UPDATE user_extra_entitlements e SET board_id=NULL FROM boards b WHERE e.board_id=b.id AND e.user_id=$1 AND e.kind='jotter' AND e.expires_at>now() AND b.owner_user_id=$1 AND b.is_empty=true AND b.is_current=false",[req.user.sub]);await c.query('DELETE FROM boards WHERE owner_user_id=$1 AND is_empty=true AND is_current=false',[req.user.sub]);const count=Number((await c.query('SELECT count(*) FROM boards WHERE owner_user_id=$1',[req.user.sub])).rows[0].count);if(count>=limit){await c.query('ROLLBACK');return res.status(403).json({error:`Hai raggiunto il limite di ${limit} Jotter disponibili.`,code:'jotter_limit',limit,owned:count})}await c.query('UPDATE boards SET is_current=false WHERE owner_user_id=$1',[req.user.sub]);await c.query('INSERT INTO boards(id,room_code,owner_user_id,title,is_empty,is_current) VALUES($1,$2,$3,$4,true,true)',[id,code,req.user.sub,req.body.title||'Jotter senza titolo']);await c.query("INSERT INTO board_members(board_id,user_id,role,status) VALUES($1,$2,'owner','approved')",[id,req.user.sub]);await c.query('COMMIT');return res.status(201).json({id,roomCode:code,title:req.body.title||'Jotter senza titolo',url:`${process.env.APP_URL}/?room=${code}`,role:'owner',ownerName:req.user.name,isCurrent:true})}catch(e){await c.query('ROLLBACK');if(e.code!=='23505')throw e}finally{c.release()}}res.status(503).json({error:'Impossibile generare un codice univoco'})});
app.post('/api/boards/join',auth,async(req,res)=>{const raw=String(req.body.roomCode||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');const c=raw.length===8?raw.slice(0,4)+'-'+raw.slice(4):String(req.body.roomCode||'').trim().toUpperCase();const q=await pool.query('SELECT b.*,u.display_name AS owner_name FROM boards b JOIN users u ON u.id=b.owner_user_id WHERE b.room_code=$1',[c]);if(!q.rows[0])return res.status(404).json({error:'Jotter non trovato'});const b=q.rows[0];if(b.owner_user_id===req.user.sub){await pool.query('BEGIN');try{await pool.query('UPDATE boards SET is_current=false WHERE owner_user_id=$1',[req.user.sub]);await pool.query('UPDATE boards SET is_current=true,empty_cleanup_after=NULL WHERE id=$1',[b.id]);await pool.query('COMMIT')}catch(e){await pool.query('ROLLBACK');throw e}}else await pool.query('UPDATE boards SET empty_cleanup_after=NULL WHERE id=$1',[b.id]);await pool.query("INSERT INTO board_members(board_id,user_id,role,status) VALUES($1,$2,'viewer','approved') ON CONFLICT DO NOTHING",[b.id,req.user.sub]);const r=await role(b.id,req.user.sub);if(!r||r.status==='revoked')return res.status(403).json({error:'Accesso a questo Jotter sospeso dal proprietario'});res.json({id:b.id,roomCode:b.room_code,title:b.title,revision:b.revision,role:r.role,ownerName:b.owner_name})});
app.get('/api/my/boards',auth,async(req,res)=>{try{await startupCleanup(req.user.sub);const q=await pool.query("SELECT b.id,b.room_code,b.title,b.created_at,b.content_updated_at,b.is_current,u.display_name AS owner_name,m.role,(SELECT COALESCE(json_agg(json_build_object('type',bo.operation_type,'payload',bo.payload) ORDER BY bo.revision),'[]'::json) FROM board_operations bo WHERE bo.board_id=b.id AND bo.is_active=true AND bo.operation_type IN ('page:set','page:delete','board:clear')) AS page_ops FROM board_members m JOIN boards b ON b.id=m.board_id JOIN users u ON u.id=b.owner_user_id WHERE m.user_id=$1 AND m.status='approved' ORDER BY (b.owner_user_id=$1 AND b.is_current=true) DESC,b.content_updated_at DESC",[req.user.sub]);res.json(q.rows.map(x=>{let pages=2;for(const op of (x.page_ops||[])){if(op.type==='page:set')pages=Math.max(1,Number(op.payload?.count)||1);else if(op.type==='page:delete')pages=Math.max(1,pages-1);else if(op.type==='board:clear')pages=2}return {id:x.id,roomCode:x.room_code,title:x.title||'Jotter senza titolo',createdAt:x.created_at,contentUpdatedAt:x.content_updated_at,ownerName:x.owner_name,role:x.role,pages,isCurrent:x.role==='owner'&&x.is_current===true}}));}catch(error){console.error('Elenco Jotter:',error);res.status(500).json({error:'Impossibile caricare i Jotter'})}});
app.post('/api/boards/:id/leave',auth,async(req,res)=>{const b=await pool.query('SELECT owner_user_id FROM boards WHERE id=$1',[req.params.id]);if(!b.rows[0])return res.sendStatus(404);if(b.rows[0].owner_user_id===req.user.sub)return res.status(400).json({error:'Il proprietario non puo uscire dal proprio Jotter (puo solo eliminarlo).'});const q=await pool.query('DELETE FROM board_members WHERE board_id=$1 AND user_id=$2 RETURNING board_id',[req.params.id,req.user.sub]);if(!q.rows[0])return res.sendStatus(404);res.json({left:true,id:req.params.id})});
app.patch('/api/boards/:id/title',auth,async(req,res)=>{const title=String(req.body.title||'').trim().slice(0,120);if(!title)return res.status(400).json({error:'Titolo non valido'});const q=await pool.query('UPDATE boards SET title=$1 WHERE id=$2 AND owner_user_id=$3 RETURNING id,title,content_updated_at',[title,req.params.id,req.user.sub]);if(!q.rows[0])return res.sendStatus(403);const event={boardId:q.rows[0].id,title:q.rows[0].title,contentUpdatedAt:q.rows[0].content_updated_at};io.to(`board:${q.rows[0].id}`).emit('board:title-updated',event);res.json({id:event.boardId,title:event.title,contentUpdatedAt:event.contentUpdatedAt})});
app.delete('/api/boards/:id',auth,async(req,res)=>{await pool.query("UPDATE user_extra_entitlements SET board_id=NULL WHERE board_id=$1 AND user_id=$2 AND kind='jotter' AND expires_at>now()",[req.params.id,req.user.sub]);const q=await pool.query('DELETE FROM boards WHERE id=$1 AND owner_user_id=$2 RETURNING id',[req.params.id,req.user.sub]);if(!q.rows[0])return res.sendStatus(403);res.json({deleted:true,id:q.rows[0].id})});
app.get('/api/admin/stats',auth,adminOnly,async(req,res)=>{const [u,b,l,o,p]=await Promise.all([pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE created_at>=current_date)::int today,count(*) FILTER(WHERE created_at>=now()-interval '7 days')::int week FROM users"),pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE created_at>=current_date)::int today,count(*) FILTER(WHERE content_updated_at>=now()-interval '24 hours')::int active FROM boards"),pool.query("SELECT count(*)::int total,count(*) FILTER(WHERE created_at>=current_date)::int today,count(DISTINCT user_id) FILTER(WHERE created_at>=now()-interval '24 hours')::int active_users FROM login_events"),pool.query('SELECT count(*)::int total FROM board_operations'),pool.query('SELECT plan_code,count(*)::int count FROM users GROUP BY plan_code')]);res.json({users:u.rows[0],boards:b.rows[0],logins:l.rows[0],operations:o.rows[0].total,plans:p.rows,online:io.engine.clientsCount,updatedAt:new Date().toISOString()})});
app.get('/api/admin/users',auth,adminOnly,async(req,res)=>{const x=await pool.query('SELECT u.id,u.email,u.display_name,u.plan_code,u.created_at,u.last_login_at,u.is_suspended,to_jsonb(u)->>$aj$privacy_notice_version$aj$ AS privacy_notice_version,to_jsonb(u)->>$aj$privacy_notice_acknowledged_at$aj$ AS privacy_notice_acknowledged_at,to_jsonb(u)->>$aj$terms_version$aj$ AS terms_version,to_jsonb(u)->>$aj$terms_accepted_at$aj$ AS terms_accepted_at,to_jsonb(u)->>$aj$registration_method$aj$ AS registration_method,count(b.id)::int AS boards FROM users u LEFT JOIN boards b ON b.owner_user_id=u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500');res.json(x.rows.map(r=>({id:r.id,email:r.email,name:r.display_name,plan:r.plan_code,createdAt:r.created_at,lastLoginAt:r.last_login_at,suspended:r.is_suspended,boards:r.boards,privacyAcknowledgedAt:r.privacy_notice_acknowledged_at,privacyVersion:r.privacy_notice_version,termsAcceptedAt:r.terms_accepted_at,termsVersion:r.terms_version,registrationMethod:r.registration_method}))) });
app.patch('/api/admin/users/:id/suspension',auth,adminOnly,async(req,res)=>{const target=await pool.query('SELECT id,email,is_suspended FROM users WHERE id=$1',[req.params.id]);const u=target.rows[0];if(!u)return res.sendStatus(404);if(String(u.email).toLowerCase()===ADMIN_EMAIL)return res.status(400).json({error:'Il titolare non può essere sospeso'});const suspended=Boolean(req.body.suspended);const x=await pool.query('UPDATE users SET is_suspended=$1,suspended_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$2 RETURNING id,email,is_suspended',[suspended,u.id]);if(suspended){for(const [id,socket] of io.of('/').sockets){if(socket.user?.sub===u.id){socket.emit('account:suspended');socket.disconnect(true)}}}res.json({id:x.rows[0].id,email:x.rows[0].email,suspended:x.rows[0].is_suspended})});
app.delete('/api/admin/users/:id',auth,adminOnly,async(req,res)=>{if(!firebaseAdminAuth)return res.status(503).json({error:'Eliminazione account temporaneamente non disponibile'});const client=await pool.connect();try{await client.query('BEGIN');const target=await client.query('SELECT id,email FROM users WHERE id=$1 FOR UPDATE',[req.params.id]);const u=target.rows[0];if(!u){await client.query('ROLLBACK');return res.sendStatus(404)}if(String(u.email).toLowerCase()===ADMIN_EMAIL){await client.query('ROLLBACK');return res.status(400).json({error:'Il titolare non può essere eliminato'})}if(firebaseAdminAuth){try{const firebaseUser=await firebaseAdminAuth.getUserByEmail(String(u.email).trim().toLowerCase());await firebaseAdminAuth.revokeRefreshTokens(firebaseUser.uid);await firebaseAdminAuth.deleteUser(firebaseUser.uid)}catch(firebaseError){if(firebaseError?.code!=='auth/user-not-found')throw firebaseError}}await client.query('UPDATE board_operations SET user_id=NULL WHERE user_id=$1',[u.id]);await client.query('DELETE FROM boards WHERE owner_user_id=$1',[u.id]);await client.query('DELETE FROM board_members WHERE user_id=$1',[u.id]);await client.query('DELETE FROM access_requests WHERE requester_user_id=$1',[u.id]);await client.query('DELETE FROM login_events WHERE user_id=$1',[u.id]);await client.query('DELETE FROM users WHERE id=$1',[u.id]);await client.query('COMMIT');for(const socket of io.of('/').sockets.values()){if(socket.user?.sub===u.id){socket.emit('account:deleted',{reason:'deleted'});socket.disconnect(true)}}res.json({deleted:true,id:u.id,firebaseDeleted:Boolean(firebaseAdminAuth)})}catch(error){try{await client.query('ROLLBACK')}catch{}console.error('Eliminazione utente:',error);res.status(500).json({error:'Eliminazione non riuscita: '+error.message})}finally{client.release()}});

app.get('/api/boards/:id/access',auth,async(req,res)=>{
 const b=(await pool.query('SELECT id,title,room_code,owner_user_id FROM boards WHERE id=$1',[req.params.id])).rows[0];
 if(!b)return res.sendStatus(404);if(b.owner_user_id!==req.user.sub)return res.sendStatus(403);
 const members=await pool.query("SELECT bm.user_id,bm.role,bm.status,u.display_name,u.email FROM board_members bm JOIN users u ON u.id=bm.user_id WHERE bm.board_id=$1 ORDER BY CASE bm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,u.display_name",[b.id]);
 const requests=await pool.query("SELECT ar.id,ar.requester_user_id,u.display_name,u.email,ar.created_at FROM access_requests ar JOIN users u ON u.id=ar.requester_user_id WHERE ar.board_id=$1 AND ar.status='pending' ORDER BY ar.created_at",[b.id]);
 res.json({id:b.id,title:b.title,roomCode:b.room_code,members:members.rows.map(x=>({userId:x.user_id,name:x.display_name,email:x.email,role:x.role,status:x.status})),requests:requests.rows.map(x=>({requestId:x.id,userId:x.requester_user_id,name:x.display_name,email:x.email,createdAt:x.created_at}))});
});
app.patch('/api/boards/:id/members/:userId/suspension',auth,async(req,res)=>{
 const b=(await pool.query('SELECT owner_user_id FROM boards WHERE id=$1',[req.params.id])).rows[0];if(!b)return res.sendStatus(404);if(b.owner_user_id!==req.user.sub)return res.sendStatus(403);if(req.params.userId===req.user.sub)return res.status(400).json({error:'Il proprietario non può essere sospeso'});
 const suspended=Boolean(req.body.suspended);const q=await pool.query("UPDATE board_members SET status=$1 WHERE board_id=$2 AND user_id=$3 AND role<>'owner' RETURNING user_id,role,status",[suspended?'revoked':'approved',req.params.id,req.params.userId]);if(!q.rows[0])return res.sendStatus(404);
 if(suspended){io.to('user:'+req.params.userId).emit('board:access-suspended',{boardId:req.params.id});}else{io.to('user:'+req.params.userId).emit('board:access-restored',{boardId:req.params.id,role:q.rows[0].role});}res.json({ok:true,suspended,status:q.rows[0].status});
});
app.delete('/api/boards/:id/members/:userId',auth,async(req,res)=>{
 const b=(await pool.query('SELECT owner_user_id FROM boards WHERE id=$1',[req.params.id])).rows[0];if(!b)return res.sendStatus(404);if(b.owner_user_id!==req.user.sub)return res.sendStatus(403);if(req.params.userId===req.user.sub)return res.status(400).json({error:'Il proprietario non può essere eliminato'});
 await pool.query('BEGIN');try{await pool.query('DELETE FROM access_requests WHERE board_id=$1 AND requester_user_id=$2',[req.params.id,req.params.userId]);const q=await pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id",[req.params.id,req.params.userId]);await pool.query('COMMIT');if(!q.rows[0])return res.sendStatus(404);io.to('user:'+req.params.userId).emit('board:access-removed',{boardId:req.params.id});res.json({deleted:true})}catch(e){await pool.query('ROLLBACK');throw e}
});
app.get('/api/boards/:id/history-state',auth,async(req,res)=>{const r=await role(req.params.id,req.user.sub);if(!r||r.status!=='approved')return res.sendStatus(403);const q=await pool.query('SELECT count(*) FILTER(WHERE is_active=true)::int AS active,count(*) FILTER(WHERE is_active=false)::int AS inactive FROM board_operations WHERE board_id=$1',[req.params.id]);res.json({canUndo:q.rows[0].active>0,canRedo:q.rows[0].inactive>0})});
app.get('/api/boards/:id/operations',auth,async(req,res)=>{const r=await role(req.params.id,req.user.sub);if(!r||r.status!=='approved')return res.sendStatus(403);const q=await pool.query('SELECT revision,operation_id,operation_type,payload,is_active FROM board_operations WHERE board_id=$1 ORDER BY revision',[req.params.id]);res.json(q.rows)});
app.get('/api/boards/:id/qr',auth,async(req,res)=>{const r=await role(req.params.id,req.user.sub);if(!r)return res.sendStatus(403);const q=await pool.query('SELECT room_code FROM boards WHERE id=$1',[req.params.id]);if(!q.rows[0])return res.sendStatus(404);res.type('png');res.send(await QRCode.toBuffer(`${process.env.APP_URL}/?room=${q.rows[0].room_code}`,{width:320,margin:2}))});
app.post('/api/boards/:id/request-edit',auth,async(req,res)=>{const r=await role(req.params.id,req.user.sub);if(!r)return res.sendStatus(403);if(r.role!=='viewer')return res.json({status:r.role});let q=await pool.query("SELECT id FROM access_requests WHERE board_id=$1 AND requester_user_id=$2 AND status='pending'",[req.params.id,req.user.sub]);let id=q.rows[0]?.id;if(!id){id=crypto.randomUUID();await pool.query("INSERT INTO access_requests(id,board_id,requester_user_id) VALUES($1,$2,$3)",[id,req.params.id,req.user.sub]);}const b=await pool.query('SELECT owner_user_id FROM boards WHERE id=$1',[req.params.id]);const event={requestId:id,boardId:req.params.id,name:req.user.name,email:req.user.email};io.to('user:'+b.rows[0].owner_user_id).emit('access:requested',event);res.json({status:'pending',requestId:id})});
app.get('/api/boards/:id/access-requests',auth,async(req,res)=>{const b=await pool.query('SELECT owner_user_id FROM boards WHERE id=$1',[req.params.id]);if(!b.rows[0]||b.rows[0].owner_user_id!==req.user.sub)return res.sendStatus(403);const q=await pool.query("SELECT ar.id,ar.board_id,u.display_name,u.email FROM access_requests ar JOIN users u ON u.id=ar.requester_user_id WHERE ar.board_id=$1 AND ar.status='pending' ORDER BY ar.created_at",[req.params.id]);res.json(q.rows.map(x=>({requestId:x.id,boardId:x.board_id,name:x.display_name,email:x.email})))});
app.post('/api/access/:id/resolve',auth,async(req,res)=>{const q=await pool.query('SELECT ar.*,b.owner_user_id FROM access_requests ar JOIN boards b ON b.id=ar.board_id WHERE ar.id=$1',[req.params.id]);const a=q.rows[0];if(!a||a.owner_user_id!==req.user.sub)return res.sendStatus(403);const approved=!!req.body.approved;await pool.query('BEGIN');await pool.query("UPDATE access_requests SET status=$1,resolved_at=now() WHERE id=$2 AND status='pending'",[approved?'approved':'denied',a.id]);if(approved)await pool.query("UPDATE board_members SET role='editor',status='approved' WHERE board_id=$1 AND user_id=$2",[a.board_id,a.requester_user_id]);await pool.query('COMMIT');io.to(`user:${a.requester_user_id}`).emit('access:resolved',{boardId:a.board_id,approved,role:approved?'editor':'viewer'});res.json({approved})});
io.use(async(socket,next)=>{try{const raw=socket.handshake.headers.cookie||'';const m=raw.match(/(?:^|; )aj_session=([^;]+)/);socket.user=jwt.verify(decodeURIComponent(m?.[1]||''),secret);const u=await pool.query('SELECT is_suspended FROM users WHERE id=$1',[socket.user.sub]);if(!u.rows[0]||u.rows[0].is_suspended)return next(new Error('account_suspended'));next()}catch{next(new Error('unauthorized'))}});
// AIRJOTTER V22.6.6A - Redis non deve impedire l'avvio del servizio.
// Su una singola istanza Render, Socket.IO continua a funzionare con l'adapter in memoria.
let pub=null,sub=null;
if(process.env.REDIS_URL){
 pub=createClient({url:process.env.REDIS_URL,socket:{connectTimeout:3000,reconnectStrategy:false}});
 sub=pub.duplicate();
 pub.on('error',error=>console.warn('Redis PUB non disponibile:',error.message));
 sub.on('error',error=>console.warn('Redis SUB non disponibile:',error.message));
 try{
  await Promise.all([pub.connect(),sub.connect()]);
  io.adapter(createAdapter(pub,sub));
  console.log('ADAPTER REDIS AIRJOTTER ATTIVO');
 }catch(error){
  console.warn('Redis temporaneamente non disponibile; uso adapter Socket.IO locale:',error.message);
  try{if(pub?.isOpen)await pub.disconnect()}catch{}
  try{if(sub?.isOpen)await sub.disconnect()}catch{}
  pub=null;sub=null;
 }
}else console.warn('REDIS_URL assente; uso adapter Socket.IO locale');

// AIRJOTTER FILE TRANSFER V22.9.0 - segnalazione effimera, nessun file sul server
const ajFileTransfers=new Map();
function ajFileTransferPublic(s){return {transferId:s.transferId,boardId:s.boardId,senderName:s.senderName,manifest:s.manifest}}
function ajFileTransferPromote(s){if(!s||s.activeReceiverId||s.pendingReceiverId)return;while(s.queue.length){const next=s.queue.shift(),sock=io.of('/').sockets.get(next.socketId);if(sock?.connected&&sock.data.currentBoardId===s.boardId){s.pendingReceiverId=next.socketId;io.to(s.senderSocketId).emit('file-transfer:request',{transferId:s.transferId,requesterSocketId:next.socketId,requesterName:next.name,manifest:s.manifest});io.to(next.socketId).emit('file-transfer:queued',{transferId:s.transferId,position:0});break}}}
function ajFileTransferEnd(s,reason='Trasferimento terminato'){if(!s)return;io.to(s.senderSocketId).emit('file-transfer:cancelled',{transferId:s.transferId,reason});if(s.activeReceiverId)io.to(s.activeReceiverId).emit('file-transfer:cancelled',{transferId:s.transferId,reason});if(s.pendingReceiverId)io.to(s.pendingReceiverId).emit('file-transfer:cancelled',{transferId:s.transferId,reason});for(const q of s.queue)io.to(q.socketId).emit('file-transfer:cancelled',{transferId:s.transferId,reason});io.to(`board:${s.boardId}`).emit('file-transfer:withdrawn',{transferId:s.transferId});ajFileTransfers.delete(s.transferId)}

io.on('connection',socket=>{socket.join(`user:${socket.user.sub}`);socket.on('board:join',async({boardId},ack)=>{const r=await role(boardId,socket.user.sub);if(!r||r.status!=='approved')return ack?.({error:'forbidden'});socket.join(`board:${boardId}`);socket.data.currentBoardId=boardId;socket.data.currentBoardRole=r.role;const own=await pool.query('SELECT owner_user_id FROM boards WHERE id=$1',[boardId]);if(own.rows[0]?.owner_user_id===socket.user.sub){cancelClearedBoardDelete(boardId);await cancelEmptyCleanup(boardId,socket.user.sub)};ack?.({ok:true,role:r.role})});socket.on('file-transfer:announce',(payload,ack)=>{try{const boardId=String(payload?.boardId||''),transferId=String(payload?.transferId||'').slice(0,100),m=payload?.manifest;if(boardId!==socket.data.currentBoardId||!transferId||!m||!Array.isArray(m.files))return ack?.({error:'Jotter non valido'});const total=Number(m.totalSize||0),count=Number(m.fileCount||m.files.length);if(total<=0||total>5*1024*1024*1024||count<1||count>10000)return ack?.({error:'Selezione non valida o superiore a 5 GB'});const clean={fileCount:count,totalSize:total,folder:Boolean(m.folder),files:m.files.slice(0,10000).map((f,i)=>({index:i,name:String(f.name||'file').slice(0,255),path:String(f.path||f.name||'file').slice(0,1024),size:Number(f.size||0),type:String(f.type||'').slice(0,120)}))};const old=[...ajFileTransfers.values()].find(x=>x.senderSocketId===socket.id);if(old)ajFileTransferEnd(old,'Nuova condivisione avviata');const s={transferId,boardId,senderSocketId:socket.id,senderName:socket.user.name||socket.user.email||'Utente AirJotter',manifest:clean,queue:[],pendingReceiverId:null,activeReceiverId:null,createdAt:Date.now(),phase:'announced'};ajFileTransfers.set(transferId,s);socket.to(`board:${boardId}`).emit('file-transfer:available',ajFileTransferPublic(s));ack?.({ok:true})}catch{ack?.({error:'Condivisione non avviata'})}});
socket.on('file-transfer:list',({boardId},ack)=>{const offers=[...ajFileTransfers.values()].filter(s=>s.boardId===boardId&&s.senderSocketId!==socket.id&&io.of('/').sockets.get(s.senderSocketId)?.connected).map(ajFileTransferPublic);ack?.({ok:true,offers})});
socket.on('file-transfer:request',({transferId},ack)=>{const s=ajFileTransfers.get(String(transferId||''));if(!s||socket.data.currentBoardId!==s.boardId||socket.id===s.senderSocketId)return ack?.({error:'Condivisione non disponibile'});if(s.activeReceiverId===socket.id||s.pendingReceiverId===socket.id||s.queue.some(q=>q.socketId===socket.id))return ack?.({ok:true,queued:true});s.queue.push({socketId:socket.id,name:socket.user.name||socket.user.email||'Utente AirJotter'});const position=s.queue.length+(s.activeReceiverId?1:0)+(s.pendingReceiverId?1:0);ack?.({ok:true,queued:position>1,position});io.to(socket.id).emit('file-transfer:queued',{transferId:s.transferId,position});ajFileTransferPromote(s)});
socket.on('file-transfer:decision',({transferId,requesterSocketId,approved})=>{const s=ajFileTransfers.get(String(transferId||''));if(!s||s.senderSocketId!==socket.id||s.pendingReceiverId!==requesterSocketId)return;s.pendingReceiverId=null;if(!approved){io.to(requesterSocketId).emit('file-transfer:rejected',{transferId:s.transferId});ajFileTransferPromote(s);return}s.activeReceiverId=requesterSocketId;s.phase='connecting';const r=io.of('/').sockets.get(requesterSocketId);io.to(socket.id).emit('file-transfer:authorized',{transferId:s.transferId,role:'sender',receiverSocketId:requesterSocketId,receiverName:r?.user?.name||r?.user?.email||'Ricevente'});io.to(requesterSocketId).emit('file-transfer:authorized',{transferId:s.transferId,role:'receiver',senderSocketId:socket.id,senderName:s.senderName,manifest:s.manifest})});
socket.on('file-transfer:signal',({transferId,targetSocketId,data})=>{const s=ajFileTransfers.get(String(transferId||''));if(!s||!targetSocketId||!data)return;const pair=(socket.id===s.senderSocketId&&targetSocketId===s.activeReceiverId)||(socket.id===s.activeReceiverId&&targetSocketId===s.senderSocketId);if(pair)io.to(targetSocketId).emit('file-transfer:signal',{transferId:s.transferId,fromSocketId:socket.id,data})});
socket.on('file-transfer:complete',({transferId})=>{const s=ajFileTransfers.get(String(transferId||''));if(!s||socket.id!==s.activeReceiverId)return;io.to(s.senderSocketId).emit('file-transfer:peer-complete',{transferId:s.transferId});s.activeReceiverId=null;ajFileTransferPromote(s)});
socket.on('file-transfer:cancel',({transferId,reason})=>{const s=ajFileTransfers.get(String(transferId||''));if(!s)return;if(socket.id===s.senderSocketId){ajFileTransferEnd(s,String(reason||'Condivisione terminata').slice(0,180));return}if(socket.id===s.activeReceiverId){io.to(s.senderSocketId).emit('file-transfer:cancelled',{transferId:s.transferId,reason:String(reason||'Ricevente disconnesso').slice(0,180)});s.activeReceiverId=null;ajFileTransferPromote(s)}else{s.queue=s.queue.filter(q=>q.socketId!==socket.id);if(s.pendingReceiverId===socket.id){s.pendingReceiverId=null;ajFileTransferPromote(s)}}});
socket.on('disconnect',()=>{const closingBoardId=socket.data.currentBoardId,closingRole=socket.data.currentBoardRole;if(closingBoardId&&closingRole==='owner')scheduleClearedBoardDelete(closingBoardId,socket.user.sub);for(const s of [...ajFileTransfers.values()]){if(s.senderSocketId===socket.id)ajFileTransferEnd(s,'Il mittente è offline');else if(s.activeReceiverId===socket.id){io.to(s.senderSocketId).emit('file-transfer:cancelled',{transferId:s.transferId,reason:'Il ricevente è offline'});s.activeReceiverId=null;ajFileTransferPromote(s)}else{s.queue=s.queue.filter(q=>q.socketId!==socket.id);if(s.pendingReceiverId===socket.id){s.pendingReceiverId=null;ajFileTransferPromote(s)}}}});socket.on('stroke:preview',async preview=>{try{if(!preview||preview.boardId!==socket.data.currentBoardId||!preview.strokeId||!Array.isArray(preview.points)||preview.points.length<1||preview.points.length>160)return;if(!['owner','editor'].includes(socket.data.currentBoardRole))return;socket.volatile.to(`board:${preview.boardId}`).emit('stroke:preview',{boardId:preview.boardId,strokeId:String(preview.strokeId).slice(0,80),points:preview.points,color:String(preview.color||'#1D1D1F').slice(0,32),isEraser:Boolean(preview.isEraser),sentAt:Number(preview.sentAt)||Date.now()});}catch{}});socket.on('board:operation',async(op,ack)=>{try{const r=await role(op.boardId,socket.user.sub);if(!r||!['owner','editor'].includes(r.role))return ack?.({error:'readonly'});const expiredJotter=Number((await pool.query("SELECT count(*) n FROM user_extra_entitlements WHERE board_id=$1 AND kind='jotter' AND expires_at<=now()",[op.boardId])).rows[0].n)>0;if(expiredJotter)return ack?.({error:'extra_expired',message:'Jotter extra scaduto: rinnova per modificarlo.'});if(op.type==='command:add'){const cmd=op.payload?.command||{},ys=cmd.type==='path'?(cmd.points||[]).map(p=>Number(p.y||0)):[Number(cmd.y||0)],touched=Math.max(0,...ys),maxPages=await boardPageLimit(op.boardId);if(Math.floor(touched/1273)>=maxPages)return ack?.({error:'page_extra_expired',message:'Questa pagina extra è scaduta: rinnova per modificarla.'})}if(!['stroke:add','text:add','command:add','page:set','page:delete','paper:set','board:clear'].includes(op.type))return ack?.({error:'invalid'});if(op.type==='page:set'){const maxPages=await boardPageLimit(op.boardId);if(Number(op.payload?.count)>maxPages)return ack?.({error:'page_limit',message:`Il piano del proprietario consente massimo ${maxPages} pagine.`});}const c=await pool.connect();try{await c.query('BEGIN');await c.query('DELETE FROM board_operations WHERE board_id=$1 AND is_active=false',[op.boardId]);const b=await c.query(`UPDATE boards SET revision=revision+1,updated_at=now(),content_updated_at=now(),empty_cleanup_after=NULL,is_empty=CASE WHEN $2='board:clear' THEN true WHEN $2 IN ('command:add','stroke:add','text:add') THEN false ELSE is_empty END WHERE id=$1 RETURNING revision`,[op.boardId,op.type]);const rev=b.rows[0].revision;await c.query('INSERT INTO board_operations(board_id,revision,operation_id,user_id,operation_type,payload) VALUES($1,$2,$3,$4,$5,$6)',[op.boardId,rev,op.operationId,socket.user.sub,op.type,op.payload]);await c.query('COMMIT');const event={...op,revision:rev};io.to(`board:${op.boardId}`).emit('board:operation',event);ack?.({ok:true,revision:rev})}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}catch{ack?.({error:'server'})}});
 socket.on('history:undo',async({boardId},ack)=>{const c=await pool.connect();try{const r=await role(boardId,socket.user.sub);if(!r||!['owner','editor'].includes(r.role))return ack?.({error:'readonly'});await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[boardId+':history']);const q=await c.query(`UPDATE board_operations SET is_active=false WHERE board_id=$1 AND revision=(SELECT max(revision) FROM board_operations WHERE board_id=$1 AND is_active=true) RETURNING operation_id,operation_type,payload,revision`,[boardId]);if(!q.rowCount){await c.query('ROLLBACK');return ack?.({error:'empty'})}const revision=(await c.query('UPDATE boards SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision',[boardId])).rows[0].revision;await c.query('COMMIT');const st=(await c.query('SELECT count(*) FILTER(WHERE is_active=true)::int active,count(*) FILTER(WHERE is_active=false)::int inactive FROM board_operations WHERE board_id=$1',[boardId])).rows[0];const event={kind:'undo',operationId:q.rows[0].operation_id,operation:{operation_id:q.rows[0].operation_id,operation_type:q.rows[0].operation_type,payload:q.rows[0].payload,revision:q.rows[0].revision,is_active:false},revision,canUndo:st.active>0,canRedo:st.inactive>0};io.to(`board:${boardId}`).emit('board:history',event);ack?.({ok:true,...event})}catch(e){try{await c.query('ROLLBACK')}catch{};console.error('history undo',e);ack?.({error:'server'})}finally{c.release()}});
 socket.on('history:redo',async({boardId},ack)=>{const c=await pool.connect();try{const r=await role(boardId,socket.user.sub);if(!r||!['owner','editor'].includes(r.role))return ack?.({error:'readonly'});await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[boardId+':history']);const q=await c.query(`UPDATE board_operations SET is_active=true WHERE board_id=$1 AND revision=(SELECT min(revision) FROM board_operations WHERE board_id=$1 AND is_active=false) RETURNING operation_id,operation_type,payload,revision`,[boardId]);if(!q.rowCount){await c.query('ROLLBACK');return ack?.({error:'empty'})}const revision=(await c.query('UPDATE boards SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision',[boardId])).rows[0].revision;await c.query('COMMIT');const st=(await c.query('SELECT count(*) FILTER(WHERE is_active=true)::int active,count(*) FILTER(WHERE is_active=false)::int inactive FROM board_operations WHERE board_id=$1',[boardId])).rows[0];const event={kind:'redo',operationId:q.rows[0].operation_id,operation:{operation_id:q.rows[0].operation_id,operation_type:q.rows[0].operation_type,payload:q.rows[0].payload,revision:q.rows[0].revision,is_active:true},revision,canUndo:st.active>0,canRedo:st.inactive>0};io.to(`board:${boardId}`).emit('board:history',event);ack?.({ok:true,...event})}catch(e){try{await c.query('ROLLBACK')}catch{};console.error('history redo',e);ack?.({error:'server'})}finally{c.release()}})
});
// v15.6: pulizia deterministica eseguita all'avvio utente e prima della creazione
if(process.env.NODE_ENV==='production'&&process.env.DEV_AUTH==='true')throw new Error('Configurazione non sicura: DEV_AUTH non può essere attivo in produzione');
if(process.env.NODE_ENV==='production'&&!process.env.ADMIN_GOOGLE_SUB)throw new Error('ADMIN_GOOGLE_SUB obbligatorio in produzione');
// AIRJOTTER_STRIPE_LINK_UPGRADE_1967B
// AIRJOTTER_STRIPE_RETURN_FIX_1967A
// AIRJOTTER_STRIPE_LIFECYCLE_1967_READY

// AIRJOTTER_NOTES_V2301A - modulo autonomo Note
// AIRJOTTER_NOTES_UX_V2301H: bianco e il colore predefinito autorevole delle Note.
// AIRJOTTER_NOTES_UX_V2301C: le note nel cestino restano conteggiate nel massimale.
// AIRJOTTER_ADMIN_NOTE_LIMITS_V2301B
function ajNoteLimit(plan){return Math.max(1,Number(plan?.notes||10))}
function ajNoteCleanHtml(value){return String(value||'').replace(/<\/?(?:script|style|iframe|object|embed|form)[^>]*>/gi,'').replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').slice(0,18000000)}
function ajNotePublic(r){return {id:r.id,title:r.title||'',body_html:r.body_html||'',color:r.color||'#ffffff',pinned:Boolean(r.pinned),attachments:Array.isArray(r.attachments)?r.attachments:[],created_at:r.created_at,updated_at:r.updated_at,deleted_at:r.deleted_at,server_revision:Number(r.server_revision||1)}}
// AIRJOTTER_NOTES_LIMIT_ENFORCEMENT_V2304S
app.get('/api/notes',auth,async(req,res)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate');try{const plan=await resolvedPlan(req.user.sub),q=await pool.query('SELECT * FROM notes WHERE user_id=$1 ORDER BY pinned DESC,updated_at DESC',[req.user.sub]);res.json({notes:q.rows.map(ajNotePublic),limit:ajNoteLimit(plan),plan:plan.code})}catch(e){console.error('Elenco Note:',e);res.status(500).json({error:'Impossibile caricare le Note'})}});
app.put('/api/notes/:id',auth,async(req,res)=>{const id=String(req.params.id||'');if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:'Nota non valida'});try{const title=String(req.body.title||'').trim().slice(0,180),body=ajNoteCleanHtml(req.body.body_html),attachments=Array.isArray(req.body.attachments)?req.body.attachments.slice(0,30):[],empty=!title&&!body.replace(/<[^>]+>/g,'').trim()&&!attachments.length;if(empty)return res.status(204).end();const plan=await resolvedPlan(req.user.sub),limit=ajNoteLimit(plan);const existing=(await pool.query('SELECT id FROM notes WHERE id=$1 AND user_id=$2',[id,req.user.sub])).rows[0];if(!existing){const count=Number((await pool.query('SELECT count(*) n FROM notes WHERE user_id=$1',[req.user.sub])).rows[0].n);if(count>=limit)return res.status(409).json({error:`Limite Note raggiunto. Il piano ${plan.name} consente ${limit} Note complessive. Hai già ${count} Note tra elenco e cestino. Elimina definitivamente una Nota dal cestino oppure passa a un piano superiore.`})}const q=await pool.query(`INSERT INTO notes(id,user_id,title,body_html,color,pinned,attachments,created_at,updated_at,deleted_at,server_revision) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()),now(),$9,1) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,body_html=EXCLUDED.body_html,color=EXCLUDED.color,pinned=EXCLUDED.pinned,attachments=EXCLUDED.attachments,updated_at=now(),deleted_at=EXCLUDED.deleted_at,server_revision=notes.server_revision+1 WHERE notes.user_id=EXCLUDED.user_id RETURNING *`,[id,req.user.sub,title,body,String(req.body.color||'#ffffff').slice(0,20),Boolean(req.body.pinned),JSON.stringify(attachments),req.body.created_at||null,req.body.deleted_at||null]);if(!q.rows[0])return res.status(403).json({error:'Nota non accessibile'});res.json(ajNotePublic(q.rows[0]))}catch(e){console.error('Salvataggio Nota:',e);res.status(500).json({error:'Nota non salvata'})}});
app.delete('/api/notes/:id',auth,async(req,res)=>{try{if(req.query.permanent==='true')await pool.query('DELETE FROM notes WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub]);else await pool.query('UPDATE notes SET deleted_at=now(),updated_at=now(),server_revision=server_revision+1 WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub]);res.json({ok:true})}catch(e){res.status(500).json({error:'Eliminazione non riuscita'})}});
app.post('/api/notes/:id/jotter',auth,async(req,res)=>{const c=await pool.connect();try{await c.query('BEGIN');const note=(await c.query('SELECT * FROM notes WHERE id=$1 AND user_id=$2',[req.params.id,req.user.sub])).rows[0];if(!note){await c.query('ROLLBACK');return res.status(404).json({error:'Nota non trovata'})}let board,created=false;if(req.body.boardId){board=(await c.query('SELECT * FROM boards WHERE id=$1 AND owner_user_id=$2 FOR UPDATE',[req.body.boardId,req.user.sub])).rows[0];if(!board){await c.query('ROLLBACK');return res.status(403).json({error:'Jotter non disponibile'})}}else{const plan=await resolvedPlan(req.user.sub),owned=Number((await c.query('SELECT count(*) n FROM boards WHERE owner_user_id=$1',[req.user.sub])).rows[0].n),extra=Number(plan.spotJotters||0);if(owned>=Number(plan.boards||0)+extra){await c.query('ROLLBACK');return res.status(409).json({error:'Hai raggiunto il limite di Jotter del tuo piano.'})}for(let i=0;i<20&&!board;i++){const id=crypto.randomUUID(),code=randomCode();try{board=(await c.query('INSERT INTO boards(id,room_code,owner_user_id,title,is_empty) VALUES($1,$2,$3,$4,false) RETURNING *',[id,code,req.user.sub,String(req.body.title||note.title||'Nota AirJotter').slice(0,120)])).rows[0]}catch(e){if(e.code!=='23505')throw e}}if(!board)throw new Error('Impossibile creare il Jotter');await c.query("INSERT INTO board_members(board_id,user_id,role,status) VALUES($1,$2,'owner','approved')",[board.id,req.user.sub]);created=true}const rev=Number((await c.query('UPDATE boards SET revision=revision+1,updated_at=now(),content_updated_at=now(),is_empty=false WHERE id=$1 RETURNING revision',[board.id])).rows[0].revision),text=String(req.body.text||note.title+'\n\n'+note.body_html.replace(/<[^>]+>/g,' ')).replace(/\s+\n/g,'\n').trim().slice(0,12000);await c.query('INSERT INTO board_operations(board_id,revision,operation_id,user_id,operation_type,payload) VALUES($1,$2,$3,$4,$5,$6)',[board.id,rev,crypto.randomUUID(),req.user.sub,'text:add',JSON.stringify({page:0,x:70,y:90,text,color:'#1d1d1f',size:22})]);await c.query('COMMIT');io.to(`board:${board.id}`).emit('board:reload');res.json({ok:true,created,boardId:board.id,roomCode:board.room_code,title:board.title})}catch(e){try{await c.query('ROLLBACK')}catch{};console.error('Nota in Jotter:',e);res.status(500).json({error:e.message||'Esportazione nel Jotter non riuscita'})}finally{c.release()}});


// AIRJOTTER_NOTES_COLOR_FINAL_V2301J: attributo estetico separato dal contenuto; non aggiorna updated_at.
// AIRJOTTER_NOTES_COLOR_TIMESTAMP_V2301K: updated_at e server_revision restano immutabili per ogni cambio colore.
app.patch('/api/notes/:id/color',auth,async(req,res)=>{try{const color=String(req.body.color||'#ffffff').trim().toLowerCase();if(!/^#[0-9a-f]{6}$/.test(color))return res.status(400).json({error:'Colore Nota non valido'});const q=await pool.query('UPDATE notes SET color=$1 WHERE id=$2 AND user_id=$3 RETURNING *',[color,req.params.id,req.user.sub]);if(!q.rows[0])return res.status(404).json({error:'Nota non trovata'});res.json(ajNotePublic(q.rows[0]))}catch(e){console.error('Colore Nota:',e);res.status(500).json({error:'Colore Nota non salvato'})}});
server.listen(process.env.PORT||3000,()=>console.log(`airjotter su porta ${process.env.PORT||3000}`));

// AIRJOTTER_V2285_EXTRAS_SUMMARY_AND_HISTORY

// AIRJOTTER_FILE_TRANSFER_V2290
