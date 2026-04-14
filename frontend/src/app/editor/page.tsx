"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/context/AuthContext";
import type { Post, FileRecord, Category } from "@/lib/api";
import {
  getAdminPosts,
  createPost,
  updatePost,
  deletePost,
  getAdminFiles,
  uploadFile,
  deleteFile,
  getDownloadUrl,
  getFileViewUrl,
  getAdminCategories,
  createCategory,
  normalizeMarkdownFileUrls,
  searchAdminResources,
  filterPostsByVisibleText,
} from "@/lib/api";
import SearchInput from "@/components/SearchInput";
import Pagination from "@/components/Pagination";
import { 
  EditIcon, 
  FileTextIcon, 
  FolderIcon, 
  PaperclipIcon, 
  TrashIcon, 
  InboxIcon, 
  UploadIcon 
} from "@/components/Icons";
import "react-markdown-editor-lite/lib/index.css";

// Markdown editor 动态导入（不支持 SSR）
const MdEditor = dynamic(() => import("react-markdown-editor-lite"), {
  ssr: false,
});

let mdParser: { render: (text: string) => string } | null = null;
if (typeof window !== "undefined") {
  const MarkdownIt = require("markdown-it");
  const { imageSizePlugin } = require("@/lib/md-plugins");
  mdParser = new MarkdownIt({ html: false }).use(imageSizePlugin);
}

type TabType = "posts" | "files";
type ViewMode = "list" | "edit";

export default function EditorPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const isMountedRef = useRef(true);
  const categoryRequestIdRef = useRef(0);
  const postRequestIdRef = useRef(0);
  const fileRequestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeTab, setActiveTab] = useState<TabType>("posts");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  
  const [posts, setPosts] = useState<Post[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<number>(0);
  const [editStatus, setEditStatus] = useState<string>("draft");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [postsLoading, setPostsLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);

  const notifyUpdate = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("blog:refresh-sidebar"));
    }
  };

  // 删除确认弹窗状态
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    type: "post" | "file" | "category";
    id: number | null;
    isDeleting: boolean;
  }>({ isOpen: false, type: "post", id: null, isDeleting: false });


  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login?redirect=/editor");
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

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
    const requestId = ++categoryRequestIdRef.current;
    const c = await getAdminCategories();
    if (!isMountedRef.current || requestId !== categoryRequestIdRef.current) {
      return;
    }
    setCategories(c);
  }

  async function loadPosts(pageToLoad: number) {
    const requestId = ++postRequestIdRef.current;
    setPostsLoading(true);
    const result = await getAdminPosts(pageToLoad, 10, "admin");
    if (!isMountedRef.current || requestId !== postRequestIdRef.current) {
      return;
    }
    setLoadError(result.error || "");
    setPosts(result.data);
    setPostPage(result.page);
    setPostTotalPages(Math.ceil(result.total / result.limit));
    setPostsLoading(false);
  }

  async function loadFiles(pageToLoad: number) {
    const requestId = ++fileRequestIdRef.current;
    setFilesLoading(true);
    const result = await getAdminFiles(pageToLoad, 10, false);
    if (!isMountedRef.current || requestId !== fileRequestIdRef.current) {
      return;
    }
    setLoadError(result.error || "");
    setFiles(result.data);
    setFilePage(result.page);
    setFileTotalPages(Math.ceil(result.total / result.limit));
    setFilesLoading(false);
  }

  async function handleSearch(query: string) {
    if (!query.trim()) {
      if (activeTab === "posts") loadPosts(1);
      else loadFiles(1);
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    const res = await searchAdminResources(query, activeTab, false);
    if (!isMountedRef.current || requestId !== searchRequestIdRef.current) {
      return;
    }

    if (activeTab === "posts") {
        setPosts(filterPostsByVisibleText(res.posts || [], query));
        setPostTotalPages(1);
    } else {
        setFiles(res.files || []);
        setFileTotalPages(1);
    }
  }

  function openEditor(post: Post) {
    setEditingPost(post);
    setEditTitle(post.title);
    setEditSummary(post.summary || "");
    setEditContent(normalizeMarkdownFileUrls(post.content));
    setEditCategoryId(post.category_id);
    setEditStatus(post.status || "draft");
    setSaveMsg("");
    setViewMode("edit");
  }

  function handleNewPost() {
    setEditingPost(null);
    setEditTitle("");
    setEditSummary("");
    setEditContent("");
    setEditCategoryId(0);
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
                summary: editSummary,
                content: editContent,
                category_id: editCategoryId || 0,
                status: editStatus,
            });
        } else {
            result = await createPost({
                title: editTitle,
                summary: editSummary,
                content: editContent,
                category_id: editCategoryId || 0,
                status: editStatus,
            });
        }

        if (result) {
            setSaveMsg("✅ Saved successfully!");
            // Refresh current post page if editing, else go to first page
            editingPost ? await loadPosts(postPage) : await loadPosts(1);
            notifyUpdate();
            router.refresh(); // Invalidate Next.js router cache
            // Auto-redirect back to list after a brief delay
            if (saveTimeoutRef.current) {
              clearTimeout(saveTimeoutRef.current);
            }
            saveTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                setViewMode("list");
              }
            }, 600);
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
    } else if (deleteModal.type === "file") {
      await deleteFile(deleteModal.id);
      await loadFiles(filePage);
    } else if (deleteModal.type === "category") {
      const { deleteCategory } = await import("@/lib/api");
      await deleteCategory(deleteModal.id);
      if (editCategoryId === deleteModal.id) setEditCategoryId(0);
      await loadCategories();
      await loadPosts(postPage); // re-fetch posts to show 'Uncategorized' fallback
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
      return getFileViewUrl(res.id);
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

  // 自定义 Select 组件带编辑器
  const CustomSelect = ({ 
    value, 
    onChange, 
    options, 
    placeholder,
    width = "100%",
    allowActions = false,
    onRename,
    onDelete
  }: { 
    value: any, 
    onChange: (val: any) => void, 
    options: { value: any, label: string }[],
    placeholder?: string,
    width?: string,
    allowActions?: boolean,
    onRename?: (id: number, newName: string) => void,
    onDelete?: (id: number) => void
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editName, setEditName] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setEditingId(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSaveRename = (id: number) => {
        if (onRename && editName.trim()) {
            onRename(id, editName.trim());
        }
        setEditingId(null);
    };

    const selectedOption = options.find(o => o.value === value);

    return (
        <div className="custom-select-container" ref={containerRef} style={{ width }}>
            <div className="custom-select-trigger" onClick={() => !editingId && setIsOpen(!isOpen)}>
                <span>{selectedOption ? selectedOption.label : placeholder}</span>
                <span style={{ fontSize: "0.8rem", opacity: 0.5, marginLeft: "10px" }}>{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && (
                <ul className="custom-select-options fade-in">
                    {options.map(opt => (
                        <li 
                            key={opt.value} 
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                            className={`custom-select-option ${value === opt.value ? "active" : ""}`}
                            onMouseEnter={(e) => {
                                const actions = e.currentTarget.querySelector('.opt-actions') as HTMLElement | null;
                                if (actions) actions.style.display = "flex";
                            }}
                            onMouseLeave={(e) => {
                                const actions = e.currentTarget.querySelector('.opt-actions') as HTMLElement | null;
                                if (actions) actions.style.display = "none";
                            }}
                        >
                            {editingId === opt.value ? (
                                <div style={{ display: "flex", gap: "5px", width: "100%" }} onClick={e => e.stopPropagation()}>
                                    <input 
                                        autoFocus
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleSaveRename(opt.value); if (e.key === 'Escape') setEditingId(null); }}
                                        style={{ flex: 1, background: "transparent", border: "1px solid var(--border-color)", color: "var(--text-primary)", padding: "2px 5px", borderRadius: "4px" }}
                                    />
                                    <button onClick={() => handleSaveRename(opt.value)} style={{ background: "var(--accent-blue)", border: "none", color: "#fff", borderRadius: "4px", cursor: "pointer", fontSize: "0.7rem", padding: "0 5px" }}>✓</button>
                                </div>
                            ) : (
                                <>
                                    <span style={{ flex: 1 }} onClick={() => { onChange(opt.value); setIsOpen(false); }}>
                                        {opt.label}
                                    </span>
                                    {allowActions && opt.value !== 0 && (
                                        <div className="opt-actions" style={{ display: "none", gap: "5px" }} onClick={e => e.stopPropagation()}>
                                                <EditIcon size={14} />
                                            <span 
                                                title="Delete"
                                                onClick={() => { onDelete && onDelete(opt.value); }}
                                                style={{ cursor: "pointer", display: "flex", alignItems: "center", color: "var(--accent-red)" }}>
                                                <TrashIcon size={14} />
                                            </span>
                                        </div>
                                    )}
                                </>
                            )}
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
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.8rem", marginBottom: "0.5rem" }}>
            <EditIcon size={28} /> Content Editor
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Manage and edit your posts and cloud drive files.
          </p>
        </div>
      </div>

      {loadError && (
        <div
          className="fade-in"
          style={{
            marginBottom: "1rem",
            padding: "0.9rem 1rem",
            background: "rgba(242, 139, 130, 0.12)",
            border: "1px solid rgba(242, 139, 130, 0.24)",
            borderRadius: "12px",
            color: "var(--accent-red)",
            fontSize: "0.9rem",
          }}
        >
          Failed to sync editor data: {loadError}
        </div>
      )}

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
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FileTextIcon size={18} /> Posts ({postsLoading ? "..." : posts.length})
              </div>
            </button>
            <button style={tabStyle("files")} onClick={() => setActiveTab("files")}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FolderIcon size={18} /> Files ({filesLoading ? "..." : files.length})
              </div>
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
                      {uploading ? "Uploading..." : (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <UploadIcon size={16} /> Upload File
                        </div>
                      )}
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
        {activeTab === "posts" && postsLoading && posts.length === 0 &&
          [1, 2, 3].map((index) => (
            <div key={`post-skeleton-${index}`} className="skeleton-pulse" style={{ height: "220px", borderRadius: "16px" }} />
          ))}

        {activeTab === "files" && filesLoading && files.length === 0 &&
          [1, 2, 3].map((index) => (
            <div key={`file-skeleton-${index}`} className="skeleton-pulse" style={{ height: "84px", borderRadius: "16px" }} />
          ))}

        {activeTab === "posts" &&
          posts.map((post) => (
            <div
              key={post.id}
              className="ai-card"
              onClick={() => {
                if (post.status === "published") {
                  router.push(`/posts/${post.id}`);
                  return;
                }
                openEditor(post);
              }}
              style={{
                padding: "1.5rem",
                cursor: "pointer",
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
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
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
                  onClick={(e) => { e.stopPropagation(); handleDeletePost(post.id); }}
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
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                  margin: "0 0 1.5rem 0",
                  flex: 1,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: "1.6",
                }}
              >
                {post.summary || <span style={{opacity: 0.4}}>No introduction provided.</span>}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "auto",
                }}
              >
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>{new Date(post.updated_at).toLocaleDateString()}</span>
                  <span style={{ 
                      background: post.category_id === 0 ? "rgba(128,128,128,0.15)" : "rgba(168, 199, 250, 0.1)",
                      color: post.category_id === 0 ? "var(--text-muted)" : "var(--accent-blue)",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                  }}>
                    {post.category_id === 0 ? "无标签" : post.category?.name || "Uncategorized"}
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); openEditor(post); }}
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
                <PaperclipIcon size={18} />
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

      {activeTab === "posts" && !postsLoading && posts.length === 0 && (
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
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem", opacity: 0.5 }}>
            <InboxIcon size={64} />
          </div>
          <p>{loadError ? `Failed to load posts: ${loadError}` : "No posts available in the admin workspace yet."}</p>
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
            INTRODUCTION
          </label>
          <textarea
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            style={{
              width: "100%",
              background: "rgba(0,0,0,0.2)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "1rem",
              color: "var(--text-secondary)",
              fontSize: "0.95rem",
              resize: "vertical",
              minHeight: "80px",
              outline: "none",
              lineHeight: 1.5,
              fontFamily: "inherit"
            }}
            placeholder="Write a brief introduction for this post..."
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
                  allowActions={true}
                  onRename={async (id, newName) => {
                      const { updateCategory } = await import("@/lib/api");
                      await updateCategory(id, newName);
                      loadCategories();
                      notifyUpdate();
                  }}
                  onDelete={(id) => {
                      setDeleteModal({ isOpen: true, type: "category", id, isDeleting: false });
                  }}
                  options={[
                      { value: 0, label: "无标签 (None)" },
                      ...categories.map(c => ({ value: c.id, label: c.name }))
                  ]}
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
                renderHTML={(text: string) => mdParser!.render(normalizeMarkdownFileUrls(text))}
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

  return (
    <>
      {viewMode === "list" ? renderListView() : renderEditView()}

      {/* 美化的删除确认弹窗 - 全局渲染，不受 viewMode 影响 */}
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
              height: "auto",
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
              {deleteModal.type === "category" && " Posts in this category will automatically become Uncategorized."}
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
    </>
  );
}
