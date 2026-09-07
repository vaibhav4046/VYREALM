"""Deterministic cinematic sci-fi set builder; preserves all objects in editable blend."""
import bpy,json,math,os,sys,random
from mathutils import Vector
def mat(name,color,metallic=0,rough=.4,emit=None,strength=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Metallic'].default_value=metallic;b.inputs['Roughness'].default_value=rough
 if emit:b.inputs['Emission Color'].default_value=(*emit,1);b.inputs['Emission Strength'].default_value=strength
 return m
def look(o,t):o.rotation_euler=(Vector(t)-o.location).to_track_quat('-Z','Y').to_euler()
def cube(n,p,s,m,bev=0):
 bpy.ops.mesh.primitive_cube_add(location=p);o=bpy.context.object;o.name=n;o.scale=s;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m)
 if bev:x=o.modifiers.new('Edge bevel','BEVEL');x.width=bev;x.segments=3
 return o
def build(req,out):
 s=bpy.context.scene;r=req.get('render',{});s.render.engine='BLENDER_EEVEE_NEXT';s.render.resolution_x=int(r.get('width',640));s.render.resolution_y=int(r.get('height',360));s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.film_transparent=False;s.frame_start=1;s.frame_end=int(r.get('frames',48));s.render.fps=int(r.get('fps',24));s.view_settings.look='AgX - Medium High Contrast';s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.003,.001,.015,1);s.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.1
 for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
 dm={m['id']:mat(m['id'],m.get('color',[.5,.2,.8]),m.get('metallic',0),m.get('roughness',.4)) for m in req.get('materials',[])}
 for q in req.get('objects',[]):
  add=getattr(bpy.ops.mesh,'primitive_'+q.get('type','cube')+'_add',None) or bpy.ops.mesh.primitive_cube_add;add(location=q.get('position',[0,0,0]),rotation=q.get('rotation',[0,0,0]));o=bpy.context.object;o.name=q['id'];o.scale=q.get('scale',[1,1,1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  if q.get('material') in dm:o.data.materials.append(dm[q['material']])
  # Keep director inputs available for editing, while the art-directed set
  # below owns the final frame so rough primitives cannot dominate the shot.
  o.hide_render=True
  for k in q.get('keyframes',[]):o.location=k.get('position',o.location);o.rotation_euler=k.get('rotation',o.rotation_euler);o.keyframe_insert('location',frame=k['frame']);o.keyframe_insert('rotation_euler',frame=k['frame'])
 floor=mat('set_floor',(.008,.005,.02),.7,.28);wall=mat('set_wall',(.012,.008,.03),.25,.5);violet=mat('hero_violet',(.12,.01,.38),.7,.2,(.25,.02,1),1.8);cyan=mat('neon_cyan',(.01,.1,.2),.3,.2,(.02,.5,1),8);white=mat('practical_white',(.35,.38,.55),.6,.2,(.2,.3,1),3)
 cube('cinematic_floor',(0,0,-.18),(16,16,.18),floor,.08);cube('cinematic_backdrop',(0,8,7),(16,.2,7),wall,.1)
 bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=3.4,depth=.28,location=(0,0,.04));p=bpy.context.object;p.name='hero_platform';p.data.materials.append(floor);x=p.modifiers.new('Platform bevel','BEVEL');x.width=.12;x.segments=3
 bpy.ops.mesh.primitive_cone_add(vertices=6,radius1=1.15,radius2=.62,depth=3.4,location=(0,0,1.85));hero=bpy.context.object;hero.name='hero_obelisk_editable';hero.data.materials.append(violet);x=hero.modifiers.new('Obelisk bevel','BEVEL');x.width=.08;x.segments=2
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.22,depth=3,location=(0,0,1.85));core=bpy.context.object;core.name='hero_energy_core';core.data.materials.append(cyan)
 for i,(rad,ma) in enumerate(((2.15,cyan),(2.7,white))):
  bpy.ops.mesh.primitive_torus_add(major_radius=rad,minor_radius=.035,major_segments=96,minor_segments=10,location=(0,0,1.85),rotation=(math.pi/2,0,0));ring=bpy.context.object;ring.name='portal_ring_'+str(i+1);ring.data.materials.append(ma);ring.keyframe_insert('rotation_euler',frame=1,index=2);ring.rotation_euler[2]=math.tau*(1 if i==0 else -1);ring.keyframe_insert('rotation_euler',frame=s.frame_end,index=2)
 for side in (-1,1):cube('frame_column_'+str(side),(side*5.2,2.6,3.1),(.34,.34,3.1),wall,.12);cube('frame_strip_'+str(side),(side*5.18,2.18,3.2),(.06,.04,2.4),cyan,.02)
 random.seed(42)
 for i in range(28):
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=random.uniform(.018,.045),location=(random.uniform(-11,11),random.uniform(5,7.5),random.uniform(2,11)));bpy.context.object.name='background_star_%02d'%i;bpy.context.object.data.materials.append(white)
 def light(n,t,p,e,c,size=4):
  bpy.ops.object.light_add(type=t,location=p);l=bpy.context.object;l.name=n;l.data.energy=e;l.data.color=c;look(l,(0,0,1.2));
  if l.data.type=='AREA':l.data.shape='DISK';l.data.size=size
 light('key_softbox','AREA',(5,-6,8),1100,(.55,.35,1),5);light('rim_blue','AREA',(-5,2,5),950,(.08,.28,1),4);light('top_practical','AREA',(0,1,9),700,(.35,.1,1),3);light('portal_fill','POINT',(0,-.8,2),260,(.15,.25,1))
 bpy.ops.object.empty_add(type='PLAIN_AXES',location=(0,0,1.4));target=bpy.context.object;target.name='camera_target_subject';bpy.ops.object.camera_add(location=(9,-14,6.5));cam=bpy.context.object;cam.name=req.get('camera',{}).get('id','hero_camera');cam.data.lens=float(req.get('camera',{}).get('lens',52));s.camera=cam;c=cam.constraints.new(type='TRACK_TO');c.target=target;c.track_axis='TRACK_NEGATIVE_Z';c.up_axis='UP_Y';cam.keyframe_insert('location',frame=1);cam.location=(6.8,-11.5,4.6);cam.keyframe_insert('location',frame=s.frame_end)
 hero.keyframe_insert('rotation_euler',frame=1,index=2);hero.rotation_euler[2]=math.tau;hero.keyframe_insert('rotation_euler',frame=s.frame_end,index=2);core.keyframe_insert('scale',frame=1);core.scale=(1.25,1.25,1);core.keyframe_insert('scale',frame=max(2,s.frame_end//2));core.scale=(1,1,1);core.keyframe_insert('scale',frame=s.frame_end)
 s.use_nodes=True;nt=s.node_tree;nt.nodes.clear();rl=nt.nodes.new('CompositorNodeRLayers');g=nt.nodes.new('CompositorNodeGlare');g.glare_type='FOG_GLOW';g.quality='LOW';g.threshold=.8;g.size=6;co=nt.nodes.new('CompositorNodeComposite');nt.links.new(rl.outputs['Image'],g.inputs['Image']);nt.links.new(g.outputs['Image'],co.inputs['Image'])
 os.makedirs(out,exist_ok=True);blend=os.path.join(out,'scene.blend');bpy.ops.wm.save_as_mainfile(filepath=blend);s.render.filepath=os.path.join(out,'frame_');bpy.ops.render.render(animation=True);bpy.ops.wm.save_as_mainfile(filepath=blend);return {'blend':'scene.blend','frames':'frame_%04d.png','frameCount':s.frame_end}
if __name__=='__main__':req=json.load(open(sys.argv[-2],encoding='utf8'));print(json.dumps(build(req,sys.argv[-1])))
