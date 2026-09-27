/// <reference lib="webworker" />
import { contextSamples, makeToneFamily, samplePixel } from '../lib/image-analysis'
import { optimizeRecipes } from '../lib/mixing'

type Request={id:number;imageId:string;data:Uint8ClampedArray;width:number;height:number;point:{x:number;y:number}}
self.onmessage=(event:MessageEvent<Request>)=>{const {id,imageId,data,width,height,point}=event.data;const colour=samplePixel(data,width,height,point);const tones=makeToneFamily(colour,contextSamples(data,width,height,point));const recipes=Object.fromEntries(tones.map(t=>[t.name,optimizeRecipes(t.colour.lab)]));self.postMessage({id,imageId,colour,tones,recipes})}
export {}
