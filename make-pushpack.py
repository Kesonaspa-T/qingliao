#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把当前仓库打成一个「推送包」（zip），拿去有 GitHub 凭据的机器上推送。

为什么需要它：
  这台机器（或 Windows 那边）没有 GitHub 推送凭据，改完代码只能打成一个包交回去。
  包里必须带 .git（提交历史、tag 都在里面），否则对方没法推。

用法（在仓库根目录，Windows / macOS 都一样）：
    python make-pushpack.py                 # 输出到仓库上一级目录
    python make-pushpack.py D:\\some\\dir     # 指定输出目录
    python make-pushpack.py -o D:\\x.zip     # 指定完整路径

推送的人拿到包之后：
    unzip qingliao-github-推送包-1.5.10.zip
    cd qingliao-github
    git push origin main
    git push origin --tags        # tag 一定要单独推，GitHub Desktop 默认不推 tag

注意：脚本会把**工作区里没提交的改动**一起打进去，但那些改动没有提交记录，
推上去不会有。所以打包之前先 commit。
"""
import os
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
# 这些目录/文件不进包：都是本地产物或机密
SKIP_DIRS = {".git/objects/tmp", "__pycache__", "node_modules", ".cache", "tmp"}
SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
# 明确不带的东西（都在 .gitignore 里，这里再挡一层防止误伤）
SKIP_PATTERNS = (".deploy/", "data/", "*.apk", "*.aab", "*.keystore", "*.jks",
                 "*.zip", "*.dmg", "/build/")


def git(*args):
    try:
        return subprocess.check_output(["git"] + list(args), cwd=HERE,
                                       stderr=subprocess.DEVNULL).decode("utf-8").strip()
    except Exception:
        return ""


def repo_name():
    base = os.path.basename(HERE.rstrip(os.sep))
    return base or "qingliao-github"


def version_label():
    tag = git("describe", "--tags", "--exact-match", "HEAD") or git("describe", "--tags", "--abbrev=0")
    if not tag:
        tag = "no-tag"
    dirty = git("status", "--porcelain")
    return tag + ("-dirty" if dirty else "")


def should_skip(rel):
    rel_unix = rel.replace("\\", "/")
    if rel_unix.split("/")[-1] in SKIP_NAMES:
        return True
    if rel_unix.endswith(SKIP_PATTERNS):
        return True
    for pat in SKIP_PATTERNS:
        if pat.startswith("/") and ("/" + pat.strip("/") + "/") in ("/" + rel_unix):
            return True
    parts = rel_unix.split("/")
    return any(p in SKIP_DIRS for p in parts[:-1])


def main(argv):
    out_dir = os.path.dirname(HERE)
    out_path = None
    if len(argv) >= 2:
        if argv[1] in ("-o", "--out"):
            out_path = os.path.abspath(argv[2])
        else:
            out_dir = os.path.abspath(argv[1])
    name = repo_name()
    label = version_label()
    if not out_path:
        out_path = os.path.join(out_dir, "%s-推送包-%s.zip" % (name, label))
    out_parent = os.path.dirname(out_path)
    if out_parent and not os.path.isdir(out_parent):
        os.makedirs(out_parent, exist_ok=True)

    dirty = git("status", "--porcelain")
    head = git("rev-parse", "--short", "HEAD")
    total = 0
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(HERE):
            rel_root = os.path.relpath(root, HERE)
            if rel_root == ".":
                rel_root = ""
            # 目录剪枝
            keep = []
            for d in sorted(dirs):
                rel = os.path.join(rel_root, d) if rel_root else d
                if should_skip(rel + "/"):
                    continue
                keep.append(d)
            dirs[:] = keep
            for f in sorted(files):
                rel = os.path.join(rel_root, f) if rel_root else f
                if should_skip(rel):
                    continue
                src = os.path.join(root, f)
                arc = name + "/" + rel.replace("\\", "/")
                try:
                    zi = zipfile.ZipInfo.from_file(src, arc)
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    with open(src, "rb") as fh:
                        zf.writestr(zi, fh.read())
                    total += 1
                except (OSError, IOError):
                    pass
    size = os.path.getsize(out_path)
    print("OK  %s" % out_path)
    print("    HEAD %s  标签 %s  文件 %d 个  %.1f MB" % (head or "?", label, total, size / 1048576.0))
    if dirty:
        print("    ⚠ 工作区有 %d 处未提交改动：这些改动在包里但**没有提交记录**，推上去不会有。"
              % len(dirty.splitlines()))
        print("      打包前先 git add -A && git commit -m \"...\" 更稳妥。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
