r"""
LDraw .dat -> .glb 批量转换脚本（Blender 后台运行）

用途：把模型用到的每种零件（designID）从 LDraw 官方零件库转成单个 .glb，
供鸿蒙端拼装动画逐零件加载。零件网格资产管线 Phase A。

依赖：
  1. Blender 4.x（已验证 4.2.3 LTS 后台可用）
  2. ImportLDraw 插件（TobyLobster 版，operator: import_scene.importldraw）
  3. LDraw 官方零件库（含 parts/ p/）

运行（PowerShell，路径按实际改）：
  & "E:\Program Files\Blender Foundation\Blender 4.2\blender.exe" --background `
    --python "D:\ClaudeCode\BlockLab\backend\scripts\ldraw_to_glb.py" -- `
    --ldraw "D:\ClaudeCode\BlockLab\tools\ldraw\library" `
    --addon "D:\ClaudeCode\BlockLab\tools\ldraw" `
    --out   "D:\ClaudeCode\BlockLab\backend\uploads\parts" `
    --parts 3021 3004 4286 3660 3298 4592c01

参数：
  --ldraw  LDraw 零件库根目录（含 parts/）
  --addon  ImportLDraw 插件所在父目录（其下需有 ImportLDraw/ 包），用于 headless 启用
  --out    glb 输出目录
  --parts  零件 designID 列表，不传则用 snail 样本 6 个
  --scale  realScale 值，默认 2500（目标 1 LDU = 1 单位，待包围盒校准）

⚠️ 尺度/坐标系标定：
  - realScale=1.0 是真实尺寸(米)，1 LDU=0.4mm。本脚本默认 realScale=2500 让 1 LDU≈1 单位，
    再交给鸿蒙端 node.scale=LDU_SCALE 统一缩放。最终以导出后打印的包围盒为准校准。
  - Blender Z-up + 插件朝向 + glTF Y-up 复合出的净朝向，需用 snail 鸿蒙端实渲标定，
    回调 LDrawTransform.ets 的 C 矩阵 / LDU_SCALE。
"""

import bpy
import sys
import os


DEFAULT_PARTS = ["3021", "3004", "4286", "3660", "3298", "4592c01"]


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    ldraw = addon = out = None
    scale = 2500.0
    parts = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--ldraw":
            ldraw = argv[i + 1]; i += 2
        elif a == "--addon":
            addon = argv[i + 1]; i += 2
        elif a == "--out":
            out = argv[i + 1]; i += 2
        elif a == "--scale":
            scale = float(argv[i + 1]); i += 2
        elif a == "--parts":
            i += 1
            while i < len(argv) and not argv[i].startswith("--"):
                parts.append(argv[i]); i += 1
        else:
            i += 1
    if not parts:
        parts = DEFAULT_PARTS
    return ldraw, addon, out, parts, scale


def enable_addon(addon_parent):
    """headless 从项目路径启用 ImportLDraw 插件"""
    if addon_parent and addon_parent not in sys.path:
        sys.path.insert(0, addon_parent)
    import ImportLDraw
    ImportLDraw.register()
    print("[ADDON] ImportLDraw 已启用")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def find_dat(ldraw_path, design_id):
    candidates = [
        os.path.join(ldraw_path, "parts", f"{design_id}.dat"),
        os.path.join(ldraw_path, "parts", "s", f"{design_id}.dat"),
        os.path.join(ldraw_path, "p", f"{design_id}.dat"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def import_ldraw(dat_path, ldraw_path, scale):
    bpy.ops.import_scene.importldraw(
        filepath=dat_path,
        ldrawPath=ldraw_path,
        realScale=scale,         # 1 LDU≈1 单位（待校准）
        resPrims="Standard",
        smoothParts=False,
        addGaps=False,           # 不留砖缝，保持精确尺寸
        bevelEdges=False,        # 不倒角
        addEnvironment=False,    # 不加地面/世界
        positionCamera=False,    # 不自动摆相机
        importCameras=False,
        numberNodes=False,
        look="normal",
        colourScheme="ldraw",
    )


def scene_bbox():
    """返回当前所有 mesh 对象的世界包围盒尺寸 (dx, dy, dz)"""
    import mathutils
    mins = [float("inf")] * 3
    maxs = [float("-inf")] * 3
    found = False
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        found = True
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            for k in range(3):
                mins[k] = min(mins[k], world[k])
                maxs[k] = max(maxs[k], world[k])
    if not found:
        return None
    return tuple(round(maxs[k] - mins[k], 3) for k in range(3))


def export_glb(out_path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
    )


def main():
    ldraw, addon, out, parts, scale = parse_args()
    if not ldraw or not out:
        print("[ERROR] 必须传 --ldraw 和 --out")
        return
    os.makedirs(out, exist_ok=True)

    try:
        enable_addon(addon)
    except Exception as e:
        print(f"[ERROR] 启用插件失败: {e}")
        return

    ok, fail = [], []
    for design_id in parts:
        dat = find_dat(ldraw, design_id)
        if not dat:
            print(f"[MISS] 库里找不到 {design_id}.dat")
            fail.append(design_id)
            continue
        try:
            clear_scene()
            import_ldraw(dat, ldraw, scale)
            bbox = scene_bbox()
            glb = os.path.join(out, f"{design_id}.glb")
            export_glb(glb)
            print(f"[OK]   {design_id}: 包围盒(单位)={bbox} -> {glb}")
            ok.append(design_id)
        except Exception as e:
            print(f"[FAIL] {design_id}: {e}")
            fail.append(design_id)

    print("\n==== 转换结果 ====")
    print(f"成功 {len(ok)}: {', '.join(ok)}")
    if fail:
        print(f"失败/缺失 {len(fail)}: {', '.join(fail)}")


if __name__ == "__main__":
    main()
