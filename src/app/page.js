export const dynamic = 'force-dynamic'; // 由于是动态博客内容，不进行全静态缓存

// 尝试向后端的 Go API 获取真实数据
async function getPosts() {
  try {
    const res = await fetch('http://localhost:8080/api/posts', { cache: 'no-store' });
    if (!res.ok) {
        throw new Error('Backend responded with non-2xx status');
    }
    return await res.json();
  } catch (error) {
    // 捕获异常：由于您目前还未开启数据库和后端服务，此处将优雅降级，展示前端 Mock 数据
    return [
      { id: 101, title: "Hello World: 博客的第一篇文章", category_id: 1, category: { name: "Life & Reading" }, created_at: new Date().toISOString() },
      { id: 102, title: "为什么放弃使用 Tailwind？", category_id: 2, category: { name: "Frontend UI" }, created_at: new Date(Date.now() - 86400000).toISOString() },
      { id: 103, title: "Gin + GORM 快速上手指南", category_id: 3, category: { name: "Backend Engineering" }, created_at: new Date(Date.now() - 86400000 * 2).toISOString() }
    ];
  }
}

export default async function Home() {
  const posts = await getPosts();

  return (
    <div>
      <h1 className="page-title">Explore Blog posts</h1>
      
      {/* 网格四象限卡片，完美映射 AI Studio 的网格 UI 质感 */}
      <div className="card-grid">
        <div className="ai-card">
          <div className="card-header">
            <div className="card-icon" style={{ backgroundColor: "rgba(251, 210, 132, 0.15)", color: "var(--accent-yellow)" }}>
              ☆
            </div>
            Featured Post
          </div>
          <p className="card-desc">
            Test out my most advanced and newly published coding tutorials.
          </p>
        </div>

        <div className="ai-card">
          <div className="card-header">
            <div className="card-icon" style={{ backgroundColor: "rgba(168, 199, 250, 0.15)", color: "var(--accent-blue)" }}>
              □
            </div>
            Code and Backend
          </div>
          <p className="card-desc">
            Build RESTful APIs, scalable services, and database tuning with Go.
          </p>
        </div>

        <div className="ai-card">
          <div className="card-header">
            <div className="card-icon" style={{ backgroundColor: "rgba(109, 214, 140, 0.15)", color: "var(--accent-green)" }}>
              ▣
            </div>
            Frontend UI
          </div>
          <p className="card-desc">
            Generate and engineer pixel-perfect Next.js web applications.
          </p>
        </div>

        <div className="ai-card">
          <div className="card-header">
            <div className="card-icon" style={{ backgroundColor: "rgba(242, 139, 130, 0.15)", color: "var(--accent-red)" }}>
              ⚡
            </div>
            Real-time Thoughts
          </div>
          <p className="card-desc">
            Read real-time insights, journals, and reflections on development life.
          </p>
        </div>
      </div>
      
      {/* 博客文章列表区域，实际联调测试 */}
      <div style={{ marginTop: "3.5rem" }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1rem" }}>Recent Articles →</p>
        
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
           {posts.length === 0 ? (
               <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>No posts available yet.</div>
           ) : (
               posts.map(post => (
                 <a key={post.id} href={`/posts/${post.id}`}>
                   <div className="ai-card" style={{ flexDirection: "row", alignItems: "center", padding: "1rem 1.5rem" }}>
                     <div className="card-icon" style={{ backgroundColor: "rgba(255,255,255,0.05)", marginRight: "1.2rem" }}>📄</div>
                     <div style={{ flex: 1 }}>
                        <h4 style={{ margin: 0, fontWeight: 500, fontSize: "1.05rem" }}>{post.title}</h4>
                        <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                           Posted on {new Date(post.created_at).toLocaleDateString()}  •  {post.category ? post.category.name : 'Uncategorized'}
                        </div>
                     </div>
                   </div>
                 </a>
               ))
           )}
        </div>
      </div>
      
      {/* 底部仿造一个搜索条 */}
      <div style={{ marginTop: "6rem", display: "flex", justifyContent: "center" }}>
        <div style={{ 
          background: "var(--bg-surface)", 
          border: "1px solid var(--border-color)", 
          borderTopRightRadius: "8px",
          borderTopLeftRadius: "8px",
          borderBottomRightRadius: "24px",
          borderBottomLeftRadius: "24px",
          padding: "1rem 1.5rem",
          display: "flex",
          width: "100%",
          maxWidth: "800px",
          color: "var(--text-muted)",
          alignItems: "center",
          gap: "1rem"
        }}>
          Search articles or type a prompt to explore my writings...
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            <div className="card-icon" style={{ background: "rgba(255,255,255,0.08)", borderRadius: "50%", padding: "6px" }}>↩</div>
          </div>
        </div>
      </div>
    </div>
  );
}
