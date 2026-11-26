interface Props {
  docName: string;
}

/**
 * 编辑区（骨架阶段）：先按原型渲染一份静态示例文档，用于验收版式与双模式骨架。
 * data-editor-host 是下一步接 CodeMirror 源码视图 / Tiptap WYSIWYG 的挂载点——
 * 真实编辑器会接管 .doc-body 区域，读取同一份 DocumentIR，不改动周围骨架。
 */
export function Editor({ docName }: Props) {
  return (
    <main className="editor" id="editor">
      <div className="doc-wrap" data-editor-host={docName}>
        <div className="kicker">写作 · 方法论</div>
        <h1>如何建立自己的知识体系</h1>
        <div className="meta">2026-11-25　·　约 2,400 字　·　预计阅读 8 分钟</div>
        <div className="doc-body">
          <p>
            我们每天都在接收大量信息，但真正能沉淀下来的少之又少。
            <strong>
              知识体系的价值，不在于存了多少，而在于能否在需要时被重新调用。
            </strong>
            这正是写作与笔记的区别：笔记是记录，写作是思考的压缩。
          </p>
          <blockquote>
            知识不是被拥有的，而是被不断重建的。每一次表达，都是一次重建。
          </blockquote>
          <h2>从收集到连接</h2>
          <p>
            大多数人卡在第一步——收集。收藏夹越来越满，大脑却越来越空。真正的转折点发生在你开始<strong>连接</strong>：把一条新信息和已有认知挂上钩，它才从“信息”变成“知识”。
          </p>
          <ul>
            <li>
              <strong>原子化</strong>：一条笔记只讲一件事，能被独立引用
            </li>
            <li>
              <strong>用自己的话</strong>：复述过的才真正理解
            </li>
            <li>
              <strong>双向链接</strong>：让笔记之间形成网络，而非孤岛
            </li>
          </ul>
          <h2>一个最小可行流程</h2>
          <p>
            不要一开始就设计复杂的分类系统。先用最简单的流程跑起来，让系统随使用自然生长：
          </p>
          <pre>
            <code>
              <span className="cm">{"// 每日写作的最小闭环\n"}</span>
              <span className="kw">capture</span>{"  →  随手记下闪念，不分类\n"}
              <span className="kw">connect</span>{"  →  写入时链接到已有笔记\n"}
              <span className="kw">distill</span>{"  →  一周后回看，压缩成一段结论\n"}
              <span className="kw">publish</span>{"  →  把结论写成文章，接受反馈"}
            </code>
          </pre>
          <p>
            这个流程里最容易被跳过的是 <code>distill</code>
            。恰恰是它，把散落的记录变成了可复用的判断。
            <span className="caret" />
          </p>
          <hr />
          <h3>写在最后</h3>
          <p>
            工具会变，方法会变，但有一件事不变：
            <strong>你必须亲手把想法写成句子</strong>。剩下的，交给时间。
          </p>
        </div>
      </div>
    </main>
  );
}
