export type RGB = { r: number; g: number; b: number }
export type XYZ = { x: number; y: number; z: number }
export type Lab = { l: number; a: number; b: number }
export type Colour = { rgb: RGB; xyz: XYZ; lab: Lab; hex: string }

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
export const hex = ({ r, g, b }: RGB) => `#${[r, g, b].map(x => clamp(x).toString(16).padStart(2, '0')).join('')}`
const linear = (v: number) => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
const gamma = (v: number) => 255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055)
export function rgbToXyz(rgb: RGB): XYZ { const r = linear(rgb.r), g = linear(rgb.g), b = linear(rgb.b); return { x: (r*.4124+g*.3576+b*.1805)*100, y: (r*.2126+g*.7152+b*.0722)*100, z: (r*.0193+g*.1192+b*.9505)*100 } }
export function xyzToRgb({x,y,z}: XYZ): RGB { x/=100;y/=100;z/=100; return { r: clamp(gamma(x*3.2406+y*-1.5372+z*-.4986)), g: clamp(gamma(x*-.9689+y*1.8758+z*.0415)), b: clamp(gamma(x*.0557+y*-.204+z*1.057)) } }
export function xyzToLab({x,y,z}: XYZ): Lab { const f=(v:number)=>v>.008856 ? Math.cbrt(v) : 7.787*v+16/116; const [fx,fy,fz]=[f(x/95.047),f(y/100),f(z/108.883)]; return {l:116*fy-16,a:500*(fx-fy),b:200*(fy-fz)} }
export function labToXyz({l,a,b}: Lab): XYZ { const fy=(l+16)/116, fx=a/500+fy, fz=fy-b/200; const q=(v:number)=>v**3>.008856?v**3:(v-16/116)/7.787; return {x:95.047*q(fx),y:100*q(fy),z:108.883*q(fz)} }
export const rgbToColour=(rgb:RGB):Colour=>{ const xyz=rgbToXyz(rgb); return {rgb,xyz,lab:xyzToLab(xyz),hex:hex(rgb)} }
export const labToColour=(lab:Lab):Colour=>{const xyz=labToXyz(lab),rgb=xyzToRgb(xyz);return{lab,xyz,rgb,hex:hex(rgb)}}

/** CIEDE2000 distance, deterministic reference implementation. */
export function deltaE2000(a: Lab, b: Lab): number { const rad=Math.PI/180, avgL=(a.l+b.l)/2, c1=Math.hypot(a.a,a.b),c2=Math.hypot(b.a,b.b),avgC=(c1+c2)/2, G=.5*(1-Math.sqrt(avgC**7/(avgC**7+25**7))), ap1=(1+G)*a.a,ap2=(1+G)*b.a,cp1=Math.hypot(ap1,a.b),cp2=Math.hypot(ap2,b.b); let hp=(x:number,y:number)=>{const v=Math.atan2(y,x)/rad;return v<0?v+360:v}; const h1=hp(ap1,a.b),h2=hp(ap2,b.b),dl=b.l-a.l,dc=cp2-cp1; let dh=h2-h1;if(cp1*cp2===0)dh=0;else if(dh>180)dh-=360;else if(dh<-180)dh+=360; const dH=2*Math.sqrt(cp1*cp2)*Math.sin(dh*rad/2), avL=(a.l+b.l)/2,avC=(cp1+cp2)/2; let avh=(h1+h2)/2;if(cp1*cp2===0)avh=h1+h2;else if(Math.abs(h1-h2)>180)avh+=avh<180?180:-180; const T=1-.17*Math.cos((avh-30)*rad)+.24*Math.cos(2*avh*rad)+.32*Math.cos((3*avh+6)*rad)-.2*Math.cos((4*avh-63)*rad),sl=1+.015*(avL-50)**2/Math.sqrt(20+(avL-50)**2),sc=1+.045*avC,sh=1+.015*avC*T,rt=-2*Math.sqrt(avC**7/(avC**7+25**7))*Math.sin(60*Math.exp(-(((avh-275)/25)**2))*rad); return Math.sqrt((dl/sl)**2+(dc/sc)**2+(dH/sh)**2+rt*(dc/sc)*(dH/sh)) }
export const mixLabs=(items:{lab:Lab; amount:number}[]):Lab=>items.reduce((out,i)=>({l:out.l+i.lab.l*i.amount,a:out.a+i.lab.a*i.amount,b:out.b+i.lab.b*i.amount}),{l:0,a:0,b:0})
