import { getPost } from "@/lib/api";
import type { Post } from "@/lib/api";
import { notFound } from "next/navigation";
import BackButton from "@/components/BackButton";

interface PostPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params;
  const post: Post | null = await getPost(id);

  if (!post) {
    notFound();
  }

  return (
    <div className="post-detail">
      {/* 文章元信息头部 */}
      <div className="post-meta" style={{ marginBottom: "2.5rem" }}>
        <span 
          className="post-category"
          style={{
            background: post.category_id === 0 ? "rgba(128,128,128,0.15)" : "rgba(168, 199, 250, 0.12)",
            color: post.category_id === 0 ? "var(--text-muted)" : "var(--accent-blue)"
          }}
        >
          {post.category_id === 0 ? "无标签" : (post.category ? post.category.name : "Uncategorized")}
        </span>
        <span className="post-date">
          {new Date(post.created_at).toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </span>
      </div>

      <h1 className="post-title" style={{ marginBottom: "2.5rem" }}>
          {post.title}
      </h1>

      {/* 文章正文内容 */}
      <article 
        className="post-body custom-html-style"
        dangerouslySetInnerHTML={{ 
            __html: (() => {
              const md = require("markdown-it")({ html: true });
              const { imageSizePlugin } = require("@/lib/md-plugins");
              return md.use(imageSizePlugin).render(post.content);
            })()
        }}
      />

      {/* 返回按钮 */}
      <div style={{ marginTop: "4rem" }}>
        <BackButton text="← Back" />
      </div>
    </div>
  );
}
