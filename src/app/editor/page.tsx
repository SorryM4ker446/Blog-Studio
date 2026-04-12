"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/context/AuthContext";
import type { Post, FileRecord, Category } from "@/lib/api";
import {
  getPosts,
  createPost,
  updatePost,
  deletePost,
  getFiles,
  uploadFile,
  deleteFile,
  getDownloadUrl,
  getCategories,
  createCategory,
  searchResources,
} from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import Pagination from "@/components/Pagination";
import "react-markdown-editor-lite/lib/index.css";

// Markdown editor 动态导入（不支持 SSR）
const MdEditor = dynamic(() => import("react-markdown-editor-lite"), {
  ssr: false,
});

let mdParser: { render: (text: string) => string } | null = null;
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const MarkdownIt = require("markdown-it");
  mdParser = new MarkdownIt({ html: false }); // 禁用 HTML 解析，防止冗余碎片代码干扰
}

type TabType = "posts" | "files";
type ViewMode = "list" | "edit";

export default function EditorPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<TabType>("posts");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  
  const [posts, setPosts] = useState<Post[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<number>(0);
  const [editStatus, setEditStatus] = useState<string>("draft");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);

  const notifyUpdate = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("blog:refresh-sidebar"));
    }
  };

  // 删除确认弹窗状态
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    type: "post" | "file";
    id: number | null;
    isDeleting: boolean;
  }>({ isOpen: false, type: "post", id: null, isDeleting: false });


  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login?redirect=/editor");
    }
  }, [user, isLoading, router]);

  const [postPage, setPostPage] = useState(1);
  const [postTotalPages, setPostTotalPages] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [fileTotalPages, setFileTotalPages] = useState(1);

  useEffect(() => {
    if (user) {
      loadCategories();
      loadPosts(1);
      loadFiles(1);
    }
  }, [user]);

  async function loadCategories() {
    const c = await getCategories();
    setCategories(c);
  }

  async function loadPosts(pageToLoad: number) {
    const result = await getPosts(pageToLoad, 10, true, "admin");
    setPosts(result.data);
    setPostPage(result.page);
    setPostTotalPages(Math.ceil(result.total / result.limit));
  }

  async function loadFiles(pageToLoad: number) {
    const result = await getFiles(pageToLoad, 10);
    setFiles(result.data);
    setFilePage(result.page);
    setFileTotalPages(Math.ceil(result.total / result.limit));
  }

  async function handleSearch(query: string) {
    if (!query.trim()) {
      if (activeTab === "posts") loadPosts(1);
      else loadFiles(1);
      return;
    }
    const res = await searchResources(query, activeTab);
    if (activeTab === "posts") {
        setPosts(res.posts || []);
        setPostTotalPages(1);
    } else {
        setFiles(res.files || []);
        setFileTotalPages(1);
    }
  }

  function openEditor(post: Post) {
    setEditingPost(post);
    setEditTitle(post.title);
    setEditContent(post.content);
    setEditCategoryId(post.category_id);
    setEditStatus(post.status || "draft");
    setSaveMsg("");
    setViewMode("edit");
  }

  function handleNewPost() {
    setEditingPost(null);
    setEditTitle("");
    setEditContent("");
    setEditCategoryId(categories.length > 0 ? categories[0].id : 0);
    setEditStatus("draft");
    setSaveMsg("");
    setViewMode("edit");
  }

  async function handleSave() {
    // Both new post and editing existing post
    if (!editTitle || !editContent) {
        setSaveMsg("❌ Title and content are required.");
        return;
    }
    setSaving(true);
    setSaveMsg("");
    
    try {
        let result = null;
        if (editingPost) {
            result = await updatePost(editingPost.id, {
                title: editTitle,
                content: editContent,
                category_id: editCategoryId || undefined,
                status: editStatus,
            });
        } else {
            result = await createPost({
                title: editTitle,
                content: editContent,
                category_id: editCategoryId || undefined,
                status: editStatus,
            });
        }

        if (result) {
            setSaveMsg("✅ Saved successfully!");
            // Refresh current post page if editing, else go to first page
            editingPost ? await loadPosts(postPage) : await loadPosts(1);
            notifyUpdate();
            // Auto-redirect back to list after a brief delay
            setTimeout(() => setViewMode("list"), 600);
        } else {
            setSaveMsg("❌ Failed to save.");
        }
    } catch (err: any) {
        setSaveMsg("❌ Failed to save: " + (err.message || "System error."));
    } finally {
        setSaving(false);
    }
  }

  async function handleCreateCategory() {
      if (!newCatName.trim()) return;
      setCreatingCat(true);
      const res = await createCategory(newCatName.trim());
      setCreatingCat(false);
      if (res) {
          setCategories([...categories, res]);
          setEditCategoryId(res.id);
          setNewCatName("");
          setShowNewCat(false);
      } else {
          alert("Failed to create category");
      }
  }

  function handleDeletePost(id: number) {
    setDeleteModal({ isOpen: true, type: "post", id, isDeleting: false });
  }

  function handleDeleteFile(id: number) {
    setDeleteModal({ isOpen: true, type: "file", id, isDeleting: false });
  }

  async function executeDelete() {
    if (!deleteModal.id) return;
    setDeleteModal(prev => ({ ...prev, isDeleting: true }));
    
    if (deleteModal.type === "post") {
      await deletePost(deleteModal.id);
      if (editingPost?.id === deleteModal.id) {
        setEditingPost(null);
        setViewMode("list");
      }
      await loadPosts(postPage);
    } else {
      await deleteFile(deleteModal.id);
      await loadFiles(filePage);
    }
    
    notifyUpdate();
    setDeleteModal({ isOpen: false, type: "post", id: null, isDeleting: false });
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    setUploading(true);
    const file = e.target.files[0];
    const res = await uploadFile(file);
    if (res) {
        loadFiles(1);
        notifyUpdate();
    } else alert("Failed to upload file.");
    setUploading(false);
    
    // reset input
    e.target.value = '';
  }

  async function handleImageUpload(file: File): Promise<string> {
    const res = await uploadFile(file, true); // 使用 system=true 进行隔离上传
    if (res) {
      return `http://localhost:8080/api/files/${res.id}/download`;
    }
    return "";
  }

  // 粘贴拦截器：防止带有 HTML 碎屑的图片粘贴插入冗余代码
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
            hasImage = true;
            break;
        }
    }
    if (hasImage) {
        // 如果包含图片，我们阻止默认的“富文本粘贴”行为（即 HTML 碎片）
        // 这样可以确保只触发 onImageUpload 的上传逻辑，避免 HTML 被注入
        e.preventDefault();
        console.log("Prevented default HTML injection for image paste");
    }
  };

  // 自定义 Select 组件
  const CustomSelect = ({ 
    value, 
    onChange, 
    options, 
    placeholder,
    width = "100%"
  }: { 
    value: any, 
    onChange: (val: any) => void, 
    options: { value: any, label: string }[],
    placeholder?: string,
    width?: string
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const selectedOption = options.find(o => o.value === value);

    return (
        <div className="custom-select-container" ref={containerRef} style={{ width }}>
            <div className="custom-select-trigger" onClick={() => setIsOpen(!isOpen)}>
                <span>{selectedOption ? selectedOption.label : placeholder}</span>
                <span style={{ fontSize: "0.8rem", opacity: 0.5, marginLeft: "10px" }}>{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && (
                <ul className="custom-select-options fade-in">
                    {options.map(opt => (
                        <li 
                            key={opt.value} 
                            className={`custom-select-option ${value === opt.value ? "active" : ""}`}
                            onClick={() => {
                                onChange(opt.value);
                                setIsOpen(false);
                            }}
                        >
                            {opt.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
  };

  const tabStyle = (tab: TabType) => ({
    padding: "10px 24px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    fontSize: "0.95rem",
    fontWeight: 600 as const,
    background:
      activeTab === tab ? "rgba(168, 199, 250, 0.15)" : "transparent",
    color:
      activeTab === tab ? "var(--accent-blue)" : "var(--text-secondary)",
    transition: "all 0.2s ease",
  });

  if (isLoading || !user) {
    return (
        <div className="fade-in" style={{ padding: "2rem" }}>
            <div className="skeleton-pulse" style={{ height: "32px", width: "250px", marginBottom: "1.5rem" }} />
            <div className="skeleton-pulse" style={{ height: "16px", width: "350px", marginBottom: "2rem" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem" }}>
                {[1, 2, 3].map(i => (
                    <div key={i} className="skeleton-pulse" style={{ height: "180px", borderRadius: "16px" }} />
                ))}
            </div>
        </div>
    );
  }

  const renderListView = () => (
    <div className="fade-in">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1 className="page-title" style={{ marginBottom: "0.5rem" }}>
            ✏️ Content Editor
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Manage and edit your posts and cloud drive files.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
          <div style={{
            display: "flex",
            gap: "0.5rem",
            background: "var(--bg-surface)",
            padding: "6px",
            borderRadius: "12px",
            width: "fit-content",
            border: "1px solid var(--border-color)",
          }}>
            <button style={tabStyle("posts")} onClick={() => setActiveTab("posts")}>
            📝 Posts ({posts.length})
            </button>
            <button style={tabStyle("files")} onClick={() => setActiveTab("files")}>
            📁 Files ({files.length})
            </button>
          </div>

          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <SearchInput 
                  placeholder={`Search ${activeTab}...`} 
                  onSearch={handleSearch} 
                  style={{ width: "220px" }} 
              />
              {activeTab === "posts" && (
                <button
                  onClick={handleNewPost}
                  style={{
                    background: "var(--accent-blue)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "10px 20px",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(168, 199, 250, 0.2)",
                  }}
                >
                  + New Post
                </button>
              )}

              {activeTab === "files" && (
                  <label
                    style={{
                      background: "var(--accent-blue)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "10px 20px",
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      cursor: uploading ? "not-allowed" : "pointer",
                      opacity: uploading ? 0.7 : 1,
                      boxShadow: "0 4px 12px rgba(168, 199, 250, 0.2)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      lineHeight: 1,
                      boxSizing: "border-box",
                    }}
                  >
                      {uploading ? "Uploading..." : "⬆ Upload File"}
                      <input type="file" style={{ display: "none" }} onChange={handleFileUpload} disabled={uploading}/>
                  </label>
              )}
          </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
          gap: "1rem",
        }}
      >
        {activeTab === "posts" &&
          posts.map((post) => (
            <div
              key={post.id}
              className="ai-card"
              style={{
                padding: "1.5rem",
                cursor: "default",
                display: "flex",
                flexDirection: "column",
                position: "relative",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "0.5rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flex: 1, minWidth: 0 }}>
                  <h3
                    style={{
                      margin: 0,
                      fontWeight: 600,
                      fontSize: "1.1rem",
                      color: "var(--text-primary)",
                      lineHeight: 1.4,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    onClick={() => openEditor(post)}
                  >
                    {post.title}
                  </h3>
                  <span
                    style={{
                      padding: "2px 10px",
                      borderRadius: "12px",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      letterSpacing: "0.03em",
                      flexShrink: 0,
                      background: post.status === "published"
                        ? "rgba(109, 214, 140, 0.15)"
                        : "rgba(255, 183, 77, 0.15)",
                      color: post.status === "published"
                        ? "var(--accent-green)"
                        : "#ffb74d",
                    }}
                  >
                    {post.status === "published" ? "Published" : "Draft"}
                  </span>
                </div>
                <button
                  onClick={() => handleDeletePost(post.id)}
                  style={{
                    background: "rgba(242, 139, 130, 0.1)",
                    color: "var(--accent-red)",
                    border: "none",
                    borderRadius: "50%",
                    width: "28px",
                    height: "28px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    flexShrink: 0,
                    marginLeft: "1rem",
                  }}
                  title="Delete post"
                >
                  ✕
                </button>
              </div>
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  margin: "0 0 1.5rem 0",
                  flex: 1,
                }}
              >
                {post.content.slice(0, 100)}...
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "auto",
                }}
              >
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  {new Date(post.updated_at).toLocaleDateString()} •{" "}
                  <span style={{ color: "var(--accent-blue)" }}>
                    {post.category?.name || "Uncategorized"}
                  </span>
                </div>
                <button
                  onClick={() => openEditor(post)}
                  style={{
                    background: "var(--accent-blue)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "6px 16px",
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "opacity 0.2s",
                  }}
                >
                  Edit
                </button>
              </div>
            </div>
          ))}

        {activeTab === "files" &&
          files.map((file) => (
            <div
              key={file.id}
              className="ai-card"
              style={{
                padding: "1.2rem 1.5rem",
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <div
                className="card-icon"
                style={{
                  backgroundColor: "rgba(168, 199, 250, 0.1)",
                  marginRight: "1.2rem",
                }}
              >
                📎
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h4
                  style={{
                    margin: 0,
                    fontWeight: 500,
                    fontSize: "1rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {file.orig_name}
                </h4>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-muted)",
                    marginTop: "0.2rem",
                  }}
                >
                  {(file.size / 1024).toFixed(1)} KB •{" "}
                  {new Date(file.created_at).toLocaleDateString()}
                </div>
              </div>
              <a 
                href={getDownloadUrl(file.id)}
                download
                style={{
                    background: "rgba(109, 214, 140, 0.12)",
                    color: "var(--accent-green)",
                    padding: "4px 12px",
                    borderRadius: "6px",
                    fontSize: "0.82rem",
                    textDecoration: "none",
                    marginRight: "1rem",
                    transition: "opacity 0.2s",
                }}>
                  Download
              </a>
              <button
                onClick={() => handleDeleteFile(file.id)}
                style={{
                  background: "rgba(242, 139, 130, 0.12)",
                  color: "var(--accent-red)",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  flexShrink: 0,
                }}
              >
                Delete
              </button>
            </div>
          ))}
      </div>

      {activeTab === "posts" && posts.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "5rem",
            color: "var(--text-muted)",
            background: "var(--bg-surface)",
            borderRadius: "16px",
            border: "1px solid var(--border-color)",
          }}
        >
          <p style={{ fontSize: "3rem" }}>📭</p>
          <p>No posts available. Start writing by creating one!</p>
        </div>
      )}

      {/* Pagination Controls */}
      {activeTab === "posts" && posts.length > 0 && (
        <Pagination 
          currentPage={postPage} 
          totalPages={postTotalPages} 
          onPageChange={(p) => loadPosts(p)} 
        />
      )}
      {activeTab === "files" && files.length > 0 && (
        <Pagination 
          currentPage={filePage} 
          totalPages={fileTotalPages} 
          onPageChange={(p) => loadFiles(p)} 
        />
      )}

      {/* 美化的删除确认弹窗 */}
      {deleteModal.isOpen && (
        <div
          className="fade-in"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            className="ai-card"
            style={{
              background: "var(--bg-surface)",
              padding: "2rem 2.5rem",
              borderRadius: "20px",
              maxWidth: "400px",
              width: "100%",
              height: "auto", // 强制高度自适应，防止拉伸
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
              border: "1px solid var(--border-color)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "64px",
                height: "64px",
                background: "rgba(242, 139, 130, 0.15)",
                color: "var(--accent-red)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "2rem",
                margin: "0 auto 1.5rem auto",
              }}
            >
              🗑️
            </div>
            <h2 style={{ margin: "0 0 10px 0", fontSize: "1.25rem", color: "var(--text-primary)" }}>
              Confirm Deletion
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", marginBottom: "2rem", lineHeight: 1.5 }}>
              Are you sure you want to delete this {deleteModal.type}? This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                onClick={() => setDeleteModal({ isOpen: false, type: "post", id: null, isDeleting: false })}
                disabled={deleteModal.isDeleting}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  color: "var(--text-primary)",
                  borderRadius: "10px",
                  fontWeight: 600,
                  cursor: deleteModal.isDeleting ? "not-allowed" : "pointer",
                  opacity: deleteModal.isDeleting ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                disabled={deleteModal.isDeleting}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  background: "var(--accent-red)",
                  border: "none",
                  color: "#fff",
                  borderRadius: "10px",
                  fontWeight: 600,
                  cursor: deleteModal.isDeleting ? "not-allowed" : "pointer",
                  opacity: deleteModal.isDeleting ? 0.6 : 1,
                  boxShadow: "0 4px 12px rgba(242, 139, 130, 0.3)",
                }}
              >
                {deleteModal.isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderEditView = () => (
    <div className="fade-in">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
          marginBottom: "2rem",
        }}
      >
        <button
          onClick={() => setViewMode("list")}
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-color)",
            color: "var(--text-primary)",
            width: "42px",
            height: "42px",
            borderRadius: "12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.2rem",
            transition: "all 0.2s ease",
          }}
          title="Back to list"
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <h1 className="page-title" style={{ margin: 0, fontSize: "1.5rem" }}>
            {editingPost ? `Editing: ${editingPost.title}` : "New Post"}
          </h1>
          {editingPost && (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "0.85rem",
                margin: "4px 0 0 0",
              }}
            >
              Last updated: {new Date(editingPost.updated_at).toLocaleString()}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.8rem", alignItems: "center" }}>
          <CustomSelect
            value={editStatus}
            onChange={setEditStatus}
            width="140px"
            options={[
                { value: "draft", label: "Draft" },
                { value: "published", label: "Published" }
            ]}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="ai-card"
            style={{
              background: "var(--accent-blue)",
              color: "#fff",
              border: "none",
              padding: "0.6rem 1.5rem",
              borderRadius: "10px",
              cursor: saving ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: "0.9rem",
              boxShadow: "0 4px 12px rgba(168, 199, 250, 0.2)",
            }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div
        style={{
          background: "var(--bg-surface)",
          borderRadius: "16px",
          padding: "2rem",
          boxShadow: "0 8px 32px rgba(0,0,0,0.1)",
          border: "1px solid rgba(255,255,255,0.05)", // 极淡的边框
        }}
      >
        <div style={{ marginBottom: "2rem" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              marginBottom: "0.8rem",
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            POST TITLE
          </label>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--border-color)", // 仅保留底边线
              borderRadius: "0",
              padding: "0.5rem 0",
              color: "var(--text-primary)",
              fontSize: "1.5rem",
              fontWeight: 500,
              outline: "none",
              boxSizing: "border-box",
            }}
            placeholder="Enter post title..."
          />
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              marginBottom: "0.8rem",
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            CATEGORY / TAG
          </label>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <CustomSelect
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  placeholder="Select a category..."
                  options={categories.map(c => ({ value: c.id, label: c.name }))}
              />
              <button 
                  onClick={() => setShowNewCat(!showNewCat)}
                  style={{
                      background: showNewCat ? "rgba(168, 199, 250, 0.15)" : "transparent",
                      border: "1px solid var(--border-color)",
                      color: "var(--accent-blue)",
                      borderRadius: "8px",
                      width: "36px",
                      height: "36px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      fontSize: "1.2rem",
                      transition: "all 0.2s"
                  }}
              >+</button>
          </div>
          {showNewCat && (
              <div className="fade-in" style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                  <input 
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      placeholder="New category name..."
                      style={{
                          background: "var(--bg-main)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "6px",
                          padding: "6px 10px",
                          color: "var(--text-primary)",
                          outline: "none",
                          fontSize: "0.9rem",
                          flex: 1,
                      }}
                  />
                  <button
                      onClick={handleCreateCategory}
                      disabled={creatingCat || !newCatName.trim()}
                      style={{
                          background: "var(--accent-blue)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          padding: "6px 12px",
                          cursor: (creatingCat || !newCatName.trim()) ? "not-allowed" : "pointer",
                          opacity: (creatingCat || !newCatName.trim()) ? 0.7 : 1,
                      }}
                  >Create</button>
              </div>
          )}
        </div>

        <div>
          <label
            style={{
              display: "block",
              fontSize: "0.8rem",
              color: "var(--text-muted)",
              marginBottom: "0.8rem",
              fontWeight: 600,
              letterSpacing: "0.05em",
            }}
          >
            CONTENT (MARKDOWN)
          </label>
          {mdParser && (
            <div className="custom-editor-wrapper" style={{ border: "none" }}>
              <MdEditor
                value={editContent}
                style={{ 
                    height: "calc(100vh - 450px)", 
                    minHeight: "450px", 
                    borderRadius: "12px",
                    border: "1px solid var(--border-color)",
                }}
                renderHTML={(text: string) => mdParser!.render(text)}
                onChange={({ text }: { text: string }) => setEditContent(text)}
                onImageUpload={handleImageUpload}
                onPaste={handlePaste}
              />
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: "1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "1rem",
          }}
        >
          {saveMsg && (
            <div
              style={{
                fontSize: "0.9rem",
                color: saveMsg.includes("✅") ? "var(--accent-green)" : "#ff6b6b",
                fontWeight: 500,
                background: saveMsg.includes("✅") ? "rgba(109, 214, 140, 0.1)" : "rgba(255, 107, 107, 0.1)",
                padding: "8px 16px",
                borderRadius: "8px",
              }}
            >
              {saveMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return viewMode === "list" ? renderListView() : renderEditView();
}
