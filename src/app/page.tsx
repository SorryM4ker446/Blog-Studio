import { getPosts } from "@/lib/api";
import type { Post } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  const posts: Post[] = await getPosts();

  return (
    <div>
      <h1 className="page-title">Explore Blog posts</h1>

      {/* 网格四象限卡片 */}
      <div className="card-grid">
        <div className="ai-card">
          <div className="card-header">
            <div
              className="card-icon"
              style={{
                backgroundColor: "rgba(251, 210, 132, 0.15)",
                color: "var(--accent-yellow)",
              }}
            >
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
            <div
              className="card-icon"
              style={{
                backgroundColor: "rgba(168, 199, 250, 0.15)",
                color: "var(--accent-blue)",
              }}
            >
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
            <div
              className="card-icon"
              style={{
                backgroundColor: "rgba(109, 214, 140, 0.15)",
                color: "var(--accent-green)",
              }}
            >
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
            <div
              className="card-icon"
              style={{
                backgroundColor: "rgba(242, 139, 130, 0.15)",
                color: "var(--accent-red)",
              }}
            >
              ⚡
            </div>
            Real-time Thoughts
          </div>
          <p className="card-desc">
            Read real-time insights, journals, and reflections on development
            life.
          </p>
        </div>
      </div>

      {/* 博客文章列表 */}
      <div style={{ marginTop: "3.5rem" }}>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "0.9rem",
            marginBottom: "1rem",
          }}
        >
          Recent Articles →
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {posts.length === 0 ? (
            <div
              style={{
                padding: "2rem",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              No posts available yet.
            </div>
          ) : (
            posts.map((post: Post) => (
              <a key={post.id} href={`/posts/${post.id}`}>
                <div
                  className="ai-card"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: "1rem 1.5rem",
                  }}
                >
                  <div
                    className="card-icon"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.05)",
                      marginRight: "1.2rem",
                    }}
                  >
                    📄
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4
                      style={{
                        margin: 0,
                        fontWeight: 500,
                        fontSize: "1.05rem",
                      }}
                    >
                      {post.title}
                    </h4>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "var(--text-muted)",
                        marginTop: "0.3rem",
                      }}
                    >
                      Posted on{" "}
                      {new Date(post.created_at).toLocaleDateString()} •{" "}
                      {post.category ? post.category.name : "Uncategorized"}
                    </div>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      {/* 底部搜索条 */}
      <div
        style={{
          marginTop: "6rem",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
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
            gap: "1rem",
          }}
        >
          Search articles or type a prompt to explore my writings...
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: "0.5rem",
            }}
          >
            <div
              className="card-icon"
              style={{
                background: "rgba(255,255,255,0.08)",
                borderRadius: "50%",
                padding: "6px",
              }}
            >
              ↩
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
