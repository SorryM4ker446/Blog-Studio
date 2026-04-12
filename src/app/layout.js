export const metadata = {
  title: "My Blog Studio",
  description: "A functional, studio-inspired developer blog",
};

import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          
          {/* 左侧导航栏 - 完全按找参考图一比一复刻风格 */}
          <aside className="sidebar">
            <div className="sidebar-header">
              {/* 可在此后替换真实 Logo */}
              <span style={{ fontWeight: 600, fontSize: "1.2rem", letterSpacing: "-0.5px" }}>Blog Studio</span>
              <span style={{ marginLeft: "auto", opacity: 0.5 }}>◿</span>
            </div>
            
            <nav className="nav-menu">
              <a href="#" className="nav-item active">
                <span className="card-icon" style={{ background: "rgba(255,255,255,0.1)", borderRadius: "4px" }}>⊞</span>
                Posts Playground
              </a>
              
              <div className="nav-group-title">Categories</div>
              <a href="#" className="nav-item">
                <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>▹</span>
                Backend Engineering
              </a>
              <a href="#" className="nav-item">
                <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>▹</span>
                Frontend UI
              </a>
              <a href="#" className="nav-item">
                <span style={{ fontSize: "1.2rem", marginLeft: "-2px" }}>▹</span>
                Life & Reading
              </a>
            </nav>
            
            <div className="sidebar-footer">
              <a href="#" className="nav-item">
                <span style={{ fontSize: "1.1rem" }}>🔍</span>
                Search
              </a>
              <a href="#" className="nav-item">
                <span style={{ fontSize: "1.1rem" }}>⚙</span>
                Settings
              </a>
            </div>
          </aside>
          
          {/* 右侧核心面板 */}
          <main className="main-content">
            <header className="top-bar">
              <div className="top-icon">⊞</div>
              Posts Playground
              <div style={{ marginLeft: "auto", display: "flex", gap: "1rem" }}>
                 {/* 占位顶部右侧小工具 */}
                 <span style={{ opacity: 0.5, cursor: "pointer" }}>⟳</span>
                 <span style={{ opacity: 0.5, cursor: "pointer" }}>⋮</span>
              </div>
            </header>
            
            <div className="content-scroll">
              {children}
            </div>
          </main>
          
        </div>
      </body>
    </html>
  );
}
