# 执行动态滚动与附件菜单配色

- 根因：右侧栏 overflow:visible!important 与未包裹的事件内容让列表溢出 viewport；菜单按钮继承 compose-bottom button 的绿色主按钮背景。
- 修改：工作台固定 100dvh 和 minmax(0,1fr) 网格行；html/body/root 不滚动。事件标题和标签栏固定，events-scroll 独立滚动，长文本换行；保留侧栏拖动边框及浮层可见性。
- 菜单：独立中性深灰底、浅灰文字、透明菜单项、低对比悬停色、灰色键盘焦点和分隔线。发送按钮仍保留主色。菜单有高度上限并可滚动。
- 回归：注入 150 条长事件，1280×832 / 1000×640 来回缩放；断言文档高度不超过 viewport、列表可滚动、标签栏留在视口；断言菜单不再继承绿色并可 Escape 关闭。附件/Skill/审批桌面回归仍通过。
- 仅构建开发版，不生成安装包。

运行：npm run test:desktop:layout-menu；npm run test:desktop:composer；npm run check。
