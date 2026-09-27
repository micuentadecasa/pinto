import type { Colour } from './color'
import type { Recipe } from './mixing'
import type { Tone } from './image-analysis'
export type StoredImage={id:'last';blob:Blob;width:number;height:number;updatedAt:number}
export type SavedSample={id:string;imageId:'last';name:string;point:{x:number;y:number};colour:Colour;tones:Tone[];recipes:Record<string,{simple:Recipe;complex:Recipe}>;createdAt:number}
const DB='pinto-v1', STORE='records';let dbPromise:Promise<IDBDatabase>|undefined
function db(){return dbPromise??=new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function get<T>(key:string){return new Promise<T|undefined>(async(resolve,reject)=>{const r=(await db()).transaction(STORE).objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function put(key:string,value:unknown){return new Promise<void>(async(resolve,reject)=>{const r=(await db()).transaction(STORE,'readwrite').objectStore(STORE).put(value,key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error)})}
export const storage={getLastImage:()=>get<StoredImage>('image:last'),saveLastImage:(image:StoredImage)=>put('image:last',image),getSamples:async()=>await get<SavedSample[]>('samples')??[],saveSample:async(sample:SavedSample)=>put('samples',[...(await storage.getSamples()),sample]),getSettings:()=>get<Record<string,unknown>>('settings'),saveSettings:(s:Record<string,unknown>)=>put('settings',s)}
