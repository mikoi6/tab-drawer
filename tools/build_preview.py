"""把 popup.html + popup.css + popup.js 合成一个自包含的 preview.html。

为什么需要它：扩展的弹窗页面依赖 chrome.* API，也没法直接用文件预览。
popup.js 里已经做了环境探测（没有扩展环境就用内存假数据），所以只要把
样式和脚本内联进同一个文件，双击就能看到真实界面。

source of truth 仍然是 popup.html / .css / .js，这个文件是产物，别手改。
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))


def read(name):
    with open(os.path.join(ROOT, name), "r", encoding="utf-8") as f:
        return f.read()


def main():
    html = read("popup.html")
    css = read("popup.css")
    js = read("popup.js")

    html = re.sub(
        r'\s*<link rel="stylesheet" href="popup\.css" />',
        "\n  <style>\n" + css + "\n  </style>",
        html,
    )
    html = re.sub(
        r'\s*<script src="popup\.js"></script>',
        "\n  <script>\n" + js + "\n  </script>",
        html,
    )
    # 让它在桌面浏览器里居中显示，像一张卡片
    html = html.replace(
        "</head>",
        "  <style>\n"
        "    body.page-preview { margin: 28px auto; border-radius: 14px; overflow: hidden;\n"
        "      box-shadow: 0 12px 48px rgba(23,25,40,.14), 0 0 0 1px #e9ebf3; }\n"
        "  </style>\n</head>",
    )
    html = html.replace("<body>", '<body class="page-preview">')

    out = os.path.join(ROOT, "preview.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", out)


if __name__ == "__main__":
    main()
