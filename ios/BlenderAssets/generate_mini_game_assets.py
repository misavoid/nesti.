"""Generate a cute low-poly cleanup asset pack in Blender.

Run with:
    blender --background --python generate_mini_game_assets.py

The script writes mini_game_assets.blend, preview.png, and individual GLB files
to an exports directory beside this file.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


OUTPUT_DIR = Path(__file__).resolve().parent
BLEND_PATH = OUTPUT_DIR / "mini_game_assets.blend"
EXPORT_DIR = OUTPUT_DIR / "exports"
PREVIEW_PATH = OUTPUT_DIR / "preview.png"
RNG = random.Random(7319)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                       bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)


def create_collection(name: str) -> bpy.types.Collection:
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def move_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def create_material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float = 0.72,
    metallic: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    return material


def create_gradient_material(name: str) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    coordinates = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    ramp.color_ramp.elements[0].color = (1.0, 0.63, 0.70, 1.0)
    ramp.color_ramp.elements[1].color = (0.34, 0.60, 0.92, 1.0)
    midpoint = ramp.color_ramp.elements.new(0.52)
    midpoint.color = (0.72, 0.68, 0.93, 1.0)
    emission.inputs["Strength"].default_value = 0.8
    links.new(coordinates.outputs["Generated"], separate.inputs[0])
    links.new(separate.outputs["Y"], ramp.inputs[0])
    links.new(ramp.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs[0], output.inputs["Surface"])
    return material


def set_active(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_transform(obj: bpy.types.Object) -> None:
    set_active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def shade_smooth(obj: bpy.types.Object) -> None:
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def add_bevel(obj: bpy.types.Object, width: float, segments: int = 2) -> None:
    modifier = obj.modifiers.new("Soft_Edges", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    set_active(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def add_cube_part(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    bevel: float = 0.04,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    apply_transform(obj)
    if bevel:
        add_bevel(obj, bevel)
    obj.data.materials.append(material)
    shade_smooth(obj)
    return obj


def join_parts(
    parts: list[bpy.types.Object],
    name: str,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    result = bpy.context.object
    result.name = name
    result.data.name = f"{name}_Mesh"
    move_to_collection(result, collection)
    return result


def create_radial_mesh(
    name: str,
    rings: list[tuple[float, float]],
    radii: list[float],
    collection: bpy.types.Collection,
    phase_offsets: list[float] | None = None,
) -> bpy.types.Object:
    count = len(radii)
    phase_offsets = phase_offsets or [0.0] * len(rings)
    vertices: list[tuple[float, float, float]] = []
    for ring_index, (z, factor) in enumerate(rings):
        phase = phase_offsets[ring_index]
        for index, radius in enumerate(radii):
            angle = math.tau * index / count + phase
            asymmetry = 1.0 + 0.035 * math.sin(angle * 2.0 + ring_index)
            vertices.append((
                radius * factor * asymmetry * math.cos(angle),
                radius * factor * math.sin(angle),
                z,
            ))

    faces: list[tuple[int, ...]] = []
    faces.append(tuple(range(count - 1, -1, -1)))
    for ring_index in range(len(rings) - 1):
        start = ring_index * count
        next_start = (ring_index + 1) * count
        for index in range(count):
            following = (index + 1) % count
            faces.append((start + index, start + following,
                          next_start + following, next_start + index))
    final_start = (len(rings) - 1) * count
    faces.append(tuple(final_start + index for index in range(count)))

    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def create_island(
    collection: bpy.types.Collection,
    grass_material: bpy.types.Material,
    earth_material: bpy.types.Material,
    sand_material: bpy.types.Material,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    radii = [1.60, 1.67, 1.58, 1.70, 1.54, 1.66, 1.60,
             1.68, 1.57, 1.64, 1.53, 1.69, 1.58, 1.65]

    rock = create_radial_mesh(
        "Island_Rock",
        [(0.10, 0.95), (-0.10, 0.98), (-0.38, 0.83),
         (-0.66, 0.58), (-0.82, 0.28)],
        radii,
        collection,
        [0.0, 0.02, -0.025, 0.035, -0.015],
    )
    rock.scale.y = 0.82
    apply_transform(rock)
    rock.data.materials.append(earth_material)
    add_bevel(rock, 0.065, 2)
    shade_smooth(rock)

    grass_core = create_radial_mesh(
        "Island_Grass",
        [(0.30, 0.98), (0.20, 1.0), (0.08, 0.96)],
        radii,
        collection,
        [0.0, 0.015, 0.0],
    )
    grass_core.scale.y = 0.82
    apply_transform(grass_core)
    grass_core.data.materials.append(grass_material)
    add_bevel(grass_core, 0.075, 2)
    shade_smooth(grass_core)

    parts = [grass_core]
    for index in range(18):
        angle = math.tau * index / 18
        radius = 1.59 + 0.06 * math.sin(index * 2.1)
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=12,
            ring_count=6,
            radius=1.0,
            location=(radius * math.cos(angle), radius * 0.82 * math.sin(angle), 0.20),
        )
        scallop = bpy.context.object
        scallop.scale = (0.25, 0.21, 0.135)
        apply_transform(scallop)
        scallop.data.materials.append(grass_material)
        shade_smooth(scallop)
        parts.append(scallop)

    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=1.0, depth=0.055,
                                        location=(0.02, -0.52, 0.345))
    sand = bpy.context.object
    sand.scale = (1.03, 0.67, 1.0)
    apply_transform(sand)
    add_bevel(sand, 0.08, 2)
    sand.data.materials.append(sand_material)
    shade_smooth(sand)
    parts.append(sand)
    grass = join_parts(parts, "Island_Grass", collection)
    return grass, rock


def create_cloud(
    collection: bpy.types.Collection,
    material: bpy.types.Material,
) -> bpy.types.Object:
    parts = []
    specs = []
    for index in range(14):
        angle = math.tau * index / 14
        specs.append((
            (1.58 * math.cos(angle), 1.12 * math.sin(angle), -0.55 + 0.06 * math.sin(index)),
            (0.62 + 0.08 * math.sin(index * 1.7),
             0.53 + 0.06 * math.cos(index * 1.3),
             0.52 + 0.06 * math.sin(index * 0.9)),
        ))
    specs.extend([
        ((-0.70, -0.15, -0.78), (0.78, 0.66, 0.58)),
        ((0.05, -0.22, -0.86), (0.86, 0.72, 0.64)),
        ((0.78, -0.08, -0.76), (0.75, 0.64, 0.56)),
    ])
    for index, (location, scale) in enumerate(specs):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8,
                                            radius=1.0, location=location)
        blob = bpy.context.object
        blob.name = f"CloudBlob_{index:02d}"
        blob.scale = scale
        apply_transform(blob)
        blob.data.materials.append(material)
        shade_smooth(blob)
        parts.append(blob)
    cloud = join_parts(parts, "Cloud", collection)
    return cloud


def create_cardboard_box(
    collection: bpy.types.Collection,
    cardboard: bpy.types.Material,
    tape: bpy.types.Material,
) -> bpy.types.Object:
    parts = [add_cube_part("BoxBody", (0, 0, 0.25), (0.36, 0.31, 0.25), cardboard, 0.065)]
    for y, angle in ((-0.32, -24), (0.32, 24)):
        flap = add_cube_part("BoxFlap", (0, y, 0.52), (0.35, 0.16, 0.025), cardboard, 0.025)
        flap.rotation_euler.x = math.radians(angle)
        apply_transform(flap)
        parts.append(flap)
    for x, angle in ((-0.37, 20), (0.37, -20)):
        flap = add_cube_part("BoxFlap", (x, 0, 0.50), (0.16, 0.29, 0.025), tape, 0.025)
        flap.rotation_euler.y = math.radians(angle)
        apply_transform(flap)
        parts.append(flap)
    box = join_parts(parts, "CardboardBox", collection)
    box.location = (-0.90, 0.28, 0.31)
    box.rotation_euler.z = math.radians(-10)
    return box


def create_can(
    collection: bpy.types.Collection,
    can_material: bpy.types.Material,
    rim_material: bpy.types.Material,
    label_material: bpy.types.Material,
) -> bpy.types.Object:
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.16, depth=0.48, location=(0, 0, 0.24))
    body = bpy.context.object
    body.data.materials.append(can_material)
    add_bevel(body, 0.025, 2)
    shade_smooth(body)
    parts.append(body)
    for z in (0.015, 0.465):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.142, minor_radius=0.014,
                                        major_segments=16, minor_segments=6,
                                        location=(0, 0, z))
        rim = bpy.context.object
        rim.data.materials.append(rim_material)
        shade_smooth(rim)
        parts.append(rim)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.133, depth=0.012,
                                        location=(0, 0, 0.478))
    top = bpy.context.object
    top.data.materials.append(rim_material)
    parts.append(top)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.034, minor_radius=0.009,
                                    major_segments=10, minor_segments=4,
                                    location=(0, -0.025, 0.489))
    tab = bpy.context.object
    tab.scale.y = 1.35
    apply_transform(tab)
    tab.data.materials.append(can_material)
    parts.append(tab)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.164, minor_radius=0.012,
                                    major_segments=16, minor_segments=5,
                                    location=(0, 0, 0.28))
    stripe = bpy.context.object
    stripe.scale.z = 2.8
    apply_transform(stripe)
    stripe.data.materials.append(label_material)
    parts.append(stripe)
    can = join_parts(parts, "DrinkCan", collection)
    can.location = (-0.62, -0.84, 0.48)
    can.scale = (0.78, 0.78, 0.78)
    can.rotation_euler = (math.radians(90), math.radians(-8), math.radians(18))
    return can


def create_bottle(
    collection: bpy.types.Collection,
    bottle_material: bpy.types.Material,
    cap_material: bpy.types.Material,
) -> bpy.types.Object:
    parts = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=(0, 0, 0.30))
    body = bpy.context.object
    body.scale = (0.19, 0.19, 0.34)
    apply_transform(body)
    body.data.materials.append(bottle_material)
    shade_smooth(body)
    parts.append(body)
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=0.13, radius2=0.075,
                                    depth=0.20, location=(0, 0, 0.57))
    shoulder = bpy.context.object
    shoulder.data.materials.append(bottle_material)
    shade_smooth(shoulder)
    parts.append(shoulder)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.075, depth=0.18,
                                        location=(0, 0, 0.75))
    neck = bpy.context.object
    neck.data.materials.append(bottle_material)
    shade_smooth(neck)
    parts.append(neck)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.09, depth=0.085,
                                        location=(0, 0, 0.88))
    cap = bpy.context.object
    cap.data.materials.append(cap_material)
    add_bevel(cap, 0.012, 1)
    parts.append(cap)
    bottle = join_parts(parts, "Bottle", collection)
    bottle.location = (0.10, -0.83, 0.38)
    bottle.scale = (0.65, 0.65, 0.65)
    bottle.rotation_euler = (math.radians(76), math.radians(10), math.radians(-18))
    return bottle


def deform_mesh(obj: bpy.types.Object, amount: float, vertical_scale: float = 0.45) -> None:
    for vertex in obj.data.vertices:
        position = vertex.co
        direction = position.normalized() if position.length else Vector((0, 0, 1))
        noise = RNG.uniform(-amount, amount)
        vertex.co += Vector((direction.x * noise, direction.y * noise,
                             direction.z * noise * vertical_scale))
    obj.data.update()


def create_trash_bag(
    collection: bpy.types.Collection,
    bag_material: bpy.types.Material,
    tie_material: bpy.types.Material,
) -> bpy.types.Object:
    parts = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8,
                                        radius=0.48, location=(0, 0, 0.44))
    bag = bpy.context.object
    bag.scale = (0.78, 0.70, 1.0)
    apply_transform(bag)
    deform_mesh(bag, 0.035)
    bag.data.materials.append(bag_material)
    shade_smooth(bag)
    parts.append(bag)
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.15, radius2=0.055,
                                    depth=0.24, location=(0, 0, 0.88))
    neck = bpy.context.object
    neck.data.materials.append(bag_material)
    shade_smooth(neck)
    parts.append(neck)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.075, minor_radius=0.022,
                                    major_segments=12, minor_segments=5,
                                    location=(0, 0, 0.82))
    tie = bpy.context.object
    tie.data.materials.append(tie_material)
    parts.append(tie)
    for x, angle in ((-0.065, -28), (0.065, 28)):
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.055, radius2=0.018,
                                        depth=0.22, location=(x, 0, 1.02),
                                        rotation=(0, math.radians(angle), 0))
        knot = bpy.context.object
        knot.data.materials.append(bag_material)
        shade_smooth(knot)
        parts.append(knot)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.13, minor_radius=0.018,
                                    major_segments=16, minor_segments=5,
                                    location=(0, -0.34, 0.43),
                                    rotation=(math.radians(90), 0, 0))
    emblem = bpy.context.object
    emblem.data.materials.append(tie_material)
    shade_smooth(emblem)
    parts.append(emblem)
    trash_bag = join_parts(parts, "TrashBag", collection)
    trash_bag.location = (0.67, -0.56, 0.29)
    trash_bag.rotation_euler.z = math.radians(-7)
    return trash_bag


def create_rock(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    collection: bpy.types.Collection,
    material: bpy.types.Material,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6,
                                        radius=0.28, location=location)
    rock = bpy.context.object
    rock.name = name
    rock.scale = scale
    apply_transform(rock)
    deform_mesh(rock, 0.035)
    rock.data.materials.append(material)
    shade_smooth(rock)
    move_to_collection(rock, collection)
    return rock


def create_grass_tuft(
    collection: bpy.types.Collection,
    material: bpy.types.Material,
) -> bpy.types.Object:
    parts = []
    blade_specs = [(-0.15, -24, 0.36), (-0.07, -11, 0.46),
                   (0.03, 5, 0.52), (0.12, 19, 0.42), (0.19, 30, 0.33)]
    for index, (x, angle, height) in enumerate(blade_specs):
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.075, radius2=0.018,
                                        depth=height, location=(x, 0, height * 0.5))
        blade = bpy.context.object
        blade.name = f"GrassBlade_{index:02d}"
        blade.rotation_euler.y = math.radians(angle)
        apply_transform(blade)
        blade.data.materials.append(material)
        shade_smooth(blade)
        parts.append(blade)
    tuft = join_parts(parts, "GrassTuft", collection)
    tuft.location = (1.04, 0.20, 0.30)
    tuft.rotation_euler.z = math.radians(-10)
    return tuft


def aim_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def create_presentation(
    collection: bpy.types.Collection,
    backdrop_material: bpy.types.Material,
) -> None:
    bpy.ops.object.camera_add(location=(4.8, -7.8, 5.6))
    camera = bpy.context.object
    camera.name = "Presentation_Camera"
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 5.0
    camera.data.lens = 58
    aim_at(camera, (0.0, -0.05, -0.18))
    move_to_collection(camera, collection)
    bpy.context.scene.camera = camera

    view_direction = (Vector((0.0, -0.05, -0.18)) - camera.location).normalized()
    bpy.ops.mesh.primitive_plane_add(size=2.0, location=camera.location + view_direction * 14.0,
                                     rotation=camera.rotation_euler)
    backdrop = bpy.context.object
    backdrop.name = "Sky_Backdrop"
    backdrop.scale = (3.0, 3.0, 1.0)
    apply_transform(backdrop)
    backdrop.data.materials.append(backdrop_material)
    move_to_collection(backdrop, collection)

    bpy.ops.object.light_add(type="AREA", location=(-3.8, -4.6, 6.8))
    key = bpy.context.object
    key.name = "Key_Light"
    key.data.energy = 1050
    key.data.shape = "DISK"
    key.data.size = 4.5
    key.data.color = (1.0, 0.78, 0.62)
    aim_at(key, (0, 0, -0.1))
    move_to_collection(key, collection)

    bpy.ops.object.light_add(type="AREA", location=(4.0, 2.5, 3.2))
    fill = bpy.context.object
    fill.name = "Fill_Light"
    fill.data.energy = 700
    fill.data.size = 5.0
    fill.data.color = (0.56, 0.76, 1.0)
    aim_at(fill, (0, 0, 0.0))
    move_to_collection(fill, collection)

    bpy.ops.object.light_add(type="AREA", location=(0.0, 3.8, 5.4))
    rim = bpy.context.object
    rim.name = "Rim_Light"
    rim.data.energy = 650
    rim.data.size = 3.0
    rim.data.color = (1.0, 0.55, 0.62)
    aim_at(rim, (0, 0.2, 0.0))
    move_to_collection(rim, collection)

    bpy.ops.object.light_add(type="AREA", location=(0.0, -5.2, -0.8))
    bounce = bpy.context.object
    bounce.name = "Cloud_Bounce_Light"
    bounce.data.energy = 480
    bounce.data.size = 4.0
    bounce.data.color = (1.0, 0.48, 0.38)
    aim_at(bounce, (0, 0, -0.65))
    move_to_collection(bounce, collection)


def configure_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100
    scene.world.color = (0.13, 0.18, 0.22)
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.62, 0.72, 0.92, 1.0)
    background.inputs["Strength"].default_value = 0.42
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.color_depth = "8"


def export_asset(filepath: Path, object_names: list[str]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    selected = []
    for name in object_names:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise RuntimeError(f"Missing export object: {name}")
        obj.select_set(True)
        selected.append(obj)
    bpy.context.view_layer.objects.active = selected[0]
    original_matrices = [obj.matrix_world.copy() for obj in selected]
    anchor = selected[0].location.copy()
    for obj in selected:
        obj.location -= anchor
    if len(selected) == 1:
        selected[0].rotation_euler = (0.0, 0.0, 0.0)
    bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
    )
    for obj, matrix in zip(selected, original_matrices):
        obj.matrix_world = matrix


def build_scene() -> None:
    clear_scene()
    bpy.context.preferences.filepaths.save_version = 0
    environment = create_collection("Environment")
    props = create_collection("Props")
    presentation = create_collection("Presentation")

    grass = create_material("Grass_Green", (0.18, 0.52, 0.025, 1.0), 0.78)
    earth = create_material("Warm_Earth", (0.34, 0.15, 0.04, 1.0), 0.88)
    sand = create_material("Sunny_Sand", (0.72, 0.38, 0.06, 1.0), 0.88)
    cloud_white = create_material("Cloud_Cream", (1.0, 0.68, 0.62, 1.0), 0.88)
    cardboard = create_material("Cardboard", (0.55, 0.25, 0.06, 1.0), 0.88)
    paper_tape = create_material("Paper_Tape", (0.92, 0.50, 0.08, 1.0), 0.84)
    can_blue = create_material("Can_Blue", (0.08, 0.40, 0.70, 1.0), 0.44, 0.10)
    aluminum = create_material("Soft_Aluminum", (0.86, 0.91, 0.91, 1.0), 0.30, 0.45)
    coral = create_material("Coral_Accent", (0.80, 0.08, 0.035, 1.0), 0.66)
    bottle_green = create_material("Bottle_Green", (0.10, 0.52, 0.38, 1.0), 0.52)
    bag_teal = create_material("TrashBag_Teal", (0.01, 0.32, 0.18, 1.0), 0.66)
    warm_gray = create_material("Warm_Stone", (0.38, 0.34, 0.25, 1.0), 0.9)
    plant_green = create_material("Plant_Green", (0.06, 0.40, 0.04, 1.0), 0.82)
    backdrop = create_gradient_material("Pastel_Sky")

    create_island(environment, grass, earth, sand)
    create_cloud(environment, cloud_white)
    create_cardboard_box(props, cardboard, paper_tape)
    create_can(props, can_blue, aluminum, coral)
    create_bottle(props, bottle_green, coral)
    create_trash_bag(props, bag_teal, cloud_white)
    create_rock("Rock_01", (-1.15, -0.24, 0.43), (1.0, 0.82, 0.60), props, warm_gray)
    create_rock("Rock_02", (1.12, -0.05, 0.41), (0.78, 1.0, 0.52), props, warm_gray)
    create_grass_tuft(props, plant_green)
    create_presentation(presentation, backdrop)
    configure_scene()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))

    exports = {
        "FloatingIsland.glb": ["Island_Grass", "Island_Rock"],
        "Cloud.glb": ["Cloud"],
        "CardboardBox.glb": ["CardboardBox"],
        "DrinkCan.glb": ["DrinkCan"],
        "Bottle.glb": ["Bottle"],
        "TrashBag.glb": ["TrashBag"],
        "Rock_01.glb": ["Rock_01"],
        "Rock_02.glb": ["Rock_02"],
        "GrassTuft.glb": ["GrassTuft"],
    }
    for filename, names in exports.items():
        export_asset(EXPORT_DIR / filename, names)

    scene = bpy.context.scene
    scene.render.filepath = str(PREVIEW_PATH)
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    print(f"Generated {BLEND_PATH}")


if __name__ == "__main__":
    build_scene()
