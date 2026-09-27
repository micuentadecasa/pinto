import { describe, expect, it } from 'vitest'
import { CATALOGUE, optimizeRecipes } from '../src/lib/mixing'
import { storage } from '../src/lib/storage'
import { rgbToColour } from '../src/lib/color'

describe('mixing and recovery',()=>{it('is deterministic and never leaves fixed catalogue',()=>{const t=rgbToColour({r:110,g:80,b:60}).lab,a=optimizeRecipes(t),b=optimizeRecipes(t);expect(a.complex.parts).toEqual(b.complex.parts);for(const p of [...a.simple.parts,...a.complex.parts])expect(CATALOGUE).toContain(p.paint);expect(a.complex.parts.length).toBeLessThanOrEqual(4)})
it('persists last normalised image and samples',async()=>{const blob=new Blob(['pixels'],{type:'image/png'});await storage.saveLastImage({id:'last',blob,width:5,height:7,updatedAt:1});expect((await storage.getLastImage())?.width).toBe(5);const colour=rgbToColour({r:1,g:2,b:3});await storage.saveSample({id:'a',imageId:'last',name:'Sample',point:{x:.5,y:.5},colour,tones:[],recipes:{},createdAt:1});expect((await storage.getSamples()).map(s=>s.id)).toContain('a')})})
