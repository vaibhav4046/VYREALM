const num = (x,min,max) => { if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max) throw Error(`SCENE_INVALID_NUMBER:${String(x).slice(0,80)}:${min}:${max}`); return x; };
const vec = (x,min=-30,max=30) => { if(!Array.isArray(x)||x.length!==3) throw Error('SCENE_INVALID_VECTOR'); return x.map(n=>num(n,min,max)); };
const name = x => { if(typeof x!=='string'|| !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(x)) throw Error('SCENE_INVALID_ID'); return x; };
const list = (x,max,min=1) => { if(!Array.isArray(x)||x.length<min||x.length>max) throw Error('SCENE_INVALID_LIST'); return x; };
const choice = (x,values) => { if(!values.includes(x)) throw Error('SCENE_INVALID_ENUM'); return x; };
const vectorSchema={type:'array',items:{type:'number'},minItems:3,maxItems:3};
const objectSchema=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const arr=(items,maxItems)=>({type:'array',items,minItems:1,maxItems});
const str={type:'string'}; const number={type:'number'};
export const sceneSchema=objectSchema({
 objects:arr(objectSchema({id:str,type:{type:'string',enum:['cube','uv_sphere','cylinder','cone','torus','plane','ico_sphere']},position:vectorSchema,rotation:vectorSchema,scale:vectorSchema,material:str,keyframes:arr(objectSchema({frame:{type:'integer'},position:vectorSchema,rotation:vectorSchema}),4)}),8),
 materials:arr(objectSchema({id:str,color:vectorSchema,metallic:number,roughness:number}),8),
 lights:arr(objectSchema({id:str,type:{type:'string',enum:['AREA','POINT','SUN','SPOT']},position:vectorSchema,rotation:vectorSchema,energy:number,color:vectorSchema}),4),
 camera:objectSchema({position:vectorSchema,rotation:vectorSchema,lens:number,keyframes:arr(objectSchema({frame:{type:'integer'},position:vectorSchema}),4)})
});
export function validateScene(raw,{frames,fps}) {
 if(!raw||typeof raw!=='object') throw Error('SCENE_REQUIRED');
 const used=new Set(); const unique=x=>{const base=name(x); let id=base, n=2; while(used.has(id)) id=`${base}-${n++}`; used.add(id); return id;};
 const keyframes=(xs,camera=false)=>list(xs,16,0).map(k=>{const supplied=Number(k.frame);const frame=supplied===0?1:num(supplied,1,frames);if(!Number.isInteger(frame))throw Error('SCENE_INVALID_FRAME');return {frame,position:vec(k.position),...(!camera?{rotation:vec(k.rotation,-Math.PI*4,Math.PI*4)}:{})};});
 const materialIds=new Map(); const materials=list(raw.materials,8).map(m=>{const id=unique(m.id); materialIds.set(m.id,materialIds.get(m.id)||id); return {id,color:vec(m.color,0,1),metallic:num(m.metallic,0,1),roughness:num(m.roughness,0,1)};});
 const objects=list(raw.objects,8).map(o=>{const material=materialIds.get(o.material);if(!material)throw Error('SCENE_UNKNOWN_MATERIAL');return {id:unique(o.id),type:choice(o.type,['cube','uv_sphere','cylinder','cone','torus','plane','ico_sphere']),position:vec(o.position),rotation:vec(o.rotation,-Math.PI*4,Math.PI*4),scale:vec(o.scale,0.01,15),material,keyframes:keyframes(o.keyframes||[])};});
 const lights=list(raw.lights,4).map(l=>({id:unique(l.id),type:choice(l.type,['AREA','POINT','SUN','SPOT']),position:vec(l.position),rotation:vec(l.rotation,-Math.PI*4,Math.PI*4),energy:num(l.energy,0,5000),color:vec(l.color,0,1)}));
 const c=raw.camera;if(!c)throw Error('SCENE_CAMERA_REQUIRED');
 let camera={id:'director_camera',position:vec(c.position),rotation:vec(c.rotation,-Math.PI*4,Math.PI*4),lens:num(c.lens,15,120),keyframes:keyframes(c.keyframes||[],true)};
 let motionAugmented=false;
 const hasMotion=o=>o.keyframes.some((k,i,a)=>i>0&&(JSON.stringify(k.position)!==JSON.stringify(a[0].position)||JSON.stringify(k.rotation)!==JSON.stringify(a[0].rotation)));
 if(!objects.some(hasMotion)){
   const target=objects[0]; const first=target.keyframes[0]||{frame:1,position:target.position,rotation:target.rotation}; const endFrame=Math.max(2,frames); const end={frame:endFrame,position:[first.position[0]+0.35,first.position[1],first.position[2]],rotation:[first.rotation[0],first.rotation[1],first.rotation[2]+0.25]}; target.keyframes=[{frame:1,position:first.position,rotation:first.rotation},end]; motionAugmented=true;
 }
 if(!camera.keyframes.length){camera.keyframes=[{frame:1,position:camera.position},{frame:Math.max(2,frames),position:[camera.position[0]-0.25,camera.position[1],camera.position[2]]}];motionAugmented=true;}
 return {id:'director_scene',objects,materials,lights,camera,render:{width:640,height:360,fps,frames},motionAugmented};
}
