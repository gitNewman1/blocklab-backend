"""
LDraw .dat -> .glb 批量转换脚本（Blender 后台运行）

用途：把模型用到的每种零件（designID）从 LDraw 官方零件库转成单个 .glb，
供鸿蒙端拼装动画逐零件加载。这是"零件网格资产管线"的 Phase A（本地手动验证）。

依赖：
  1. Blender 4.x（建议 4.2 LTS）
  2. ImportLDraw 插件（TobyLobster 版，需在 Blender 里先启用）
  3. LDraw 官方零件库（complete.zip 解压后的根目录，含 parts/ p/）

运行（Windows PowerShell，路径按实际改）：
  & "C:\Program Files\Blender Foundation\Blender 4.2\blender.exe" --background `
    --python scripts\ldraw_to_glb.py -- `
    --ldraw "D:\ldraw" `
    --out   "D:\ClaudeCode\BlockLab\backend\uploads\parts" `
    --parts 3021 3004 4286 3660 3298 4592c01

说明：
  - `--` 之后是传给本脚本的参数（Blender 约定）。
  - --parts 不传时，默认转 snail 样本的 6 个零件。
  - 输出文件名为 {designID}.glb，与后端 partMeshes 返回的 /static/parts/{id}.glb 对应。

⚠️ 坐标系标定：Blender 是 Z-up，ImportLDraw 有自己的导入朝向/缩放，glTF 导出又转 Y-up，
   这三者复合出的净朝向需要用 snail 在鸿蒙端实际渲染来标定，再回调
   HM_Blocklab/.../common/utils/LDrawTransform.ets 里的 C 矩阵 / LDU_SCALE。
   本脚本用 importScale=1.0（1 LDU = 1 单位），把缩放交给鸿蒙端 node.scale=LDU_SCALE 处理。
"""

import bpy
import sys
import os


# snail 样本默认零件
DEFAULT_PARTS = ["3021", "3004", "4286", "3660", "3298", "4592c01"]


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    ldraw = None
    out = None
    parts = []
    i = 0
    while i < len(argv):
        if argv[i] == "--ldraw":
            ldraw = argv[i + 1]; i += 2
        elif argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--parts":
            i += 1
            while i < len(argv) and not argv[i].startswith("--"):
                parts.append(argv[i]); i += 1
        else:
            i += 1
    if not parts:
        parts = DEFAULT_PARTS
    return ldraw, out, parts


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # 清残留数据块
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def find_dat(ldraw_path, design_id):
    """在零件库里定位 {id}.dat（优先 parts/，再 parts/s/）"""
    candidates = [
        os.path.join(ldraw_path, "parts", f"{design_id}.dat"),
        os.path.join(ldraw_path, "parts", "s", f"{design_id}.dat"),
        os.path.join(ldraw_path, "p", f"{design_id}.dat"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def import_ldraw(dat_path, ldraw_path):
    """调用 ImportLDraw 插件导入单个零件。
    operator/参数名按 TobyLobster 版；若你装的是其他 fork，名字可能不同，按报错调整。"""
    bpy.ops.import_scene.importldraw(
        filepath=dat_path,
        ldrawPath=ldraw_path,
        importScale=1.0,      # 1 LDU = 1 单位，缩放交给客户端 node.scale
        resolution="Standard",
        gaps=False,           # 不留砖缝，保持精确尺寸
        bevelEdges=False,     # 不倒角，几何干净
        addEnvironment=False,
        positionCamera=False,
        numberNodes=False,
    )


def export_glb(out_path):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,      # glTF 标准 Y-up
        export_apply=True,    # 应用修改器，烘焙变换
    )


def main():
    ldraw, out, parts = parse_args()
    if not ldraw or not out:
        print("[ERROR] 必须传 --ldraw <零件库根目录> 和 --out <输出目录>")
        return
    os.makedirs(out, exist_ok=True)

    ok, fail = [], []
    for design_id in parts:
        dat = find_dat(ldraw, design_id)
        if not dat:
            print(f"[MISS] 零件库里找不到 {design_id}.dat（可能是 Studio 自定义件/组合件，需另行处理）")
            fail.append(design_id)
            continue
        try:
            clear_scene()
            import_ldraw(dat, ldraw)
            glb = os.path.join(out, f"{design_id}.glb")
            export_glb(glb)
            print(f"[OK]   {design_id}.dat -> {glb}")
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
