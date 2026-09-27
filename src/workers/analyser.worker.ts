/// <reference lib="webworker" />
import { contextSamples, makeToneFamily, sampleRegion } from '../lib/image-analysis'
import { optimizeRecipes } from '../lib/mixing'

type Request={id:number;data:Uint8ClampedArray;width:number;height:number;point:{x:number;y:number};size:number}
self.onmessage=(event:MessageEvent<Request>)=>{const {id,data,width,height,point,size}=event.data;const colour=sampleRegion(data,width,height,point,size);const tones=makeToneFamily(colour,contextSamples(data,width,height,point));const recipes=Object.fromEntries(tones.map(t=>[t.name,optimizeRecipes(t.colour.lab)]));self.postMessage({id,colour,tones,recipes})}
export {}
