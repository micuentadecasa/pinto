import { describe, expect, it } from 'vitest'
import { deltaE2000, rgbToColour } from '../src/lib/color'
import { makeToneFamily, sampleRegion, screenToImage } from '../src/lib/image-analysis'

describe('image analysis',()=>{it('maps display points explicitly to source pixels',()=>expect(screenToImage({x:210,y:110},{left:10,top:10,scale:2,pan:{x:0,y:0}},{width:500,height:500})).toEqual({x:100,y:50}))
it('samples a robust colour while rejecting bright luminance outlier',()=>{const d=new Uint8ClampedArray(9*9*4);for(let i=0;i<d.length;i+=4)d.set([100,50,25,255],i);d.set([255,255,255,255],0);const c=sampleRegion(d,9,9,{x:4,y:4},9);expect(c.rgb.r).toBe(100);expect(c.rgb.g).toBe(50)})
it('orders tones and rejects an unrelated hue',()=>{const base=rgbToColour({r:150,g:75,b:40}),light=rgbToColour({r:205,g:130,b:85}),dark=rgbToColour({r:75,g:32,b:20}),blue=rgbToColour({r:0,g:50,b:245});const tones=makeToneFamily(base,[light,dark,blue]);expect(tones.map(t=>t.name)).toEqual(['Highlight','Light','Base','Shadow','Deep Shadow']);expect(tones[0].colour.lab.l).toBeGreaterThan(tones[4].colour.lab.l);expect(tones.some(t=>t.colour.hex===blue.hex)).toBe(false)})
it('has zero deltaE for same colour',()=>{const c=rgbToColour({r:100,g:120,b:60});expect(deltaE2000(c.lab,c.lab)).toBe(0)})})
