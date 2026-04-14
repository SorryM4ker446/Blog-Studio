param(
  [string]$ApiBase = "http://localhost:8080/api",
  [string]$Username = "admin",
  [string]$Password = "123456"
)

$ErrorActionPreference = "Stop"

function Invoke-ApiJson {
  param(
    [string]$Method,
    [string]$Url,
    [object]$Body = $null,
    [hashtable]$Headers = @{}
  )

  $invokeParams = @{
    Uri = $Url
    Method = $Method
    Headers = $Headers
    ContentType = "application/json"
  }

  if ($null -ne $Body) {
    $invokeParams.Body = ($Body | ConvertTo-Json -Depth 10)
  }

  return Invoke-RestMethod @invokeParams
}

Write-Host "Logging in as $Username ..."
$login = Invoke-ApiJson -Method "Post" -Url "$ApiBase/login" -Body @{
  username = $Username
  password = $Password
}

$headers = @{
  Authorization = "Bearer $($login.token)"
}

$unique = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$categoryName = "smoke-$unique"
$draftTitle = "Smoke Draft $unique"
$publishedTitle = "Smoke Published $unique"
$filePath = Join-Path $env:TEMP "smoke-$unique.txt"

Set-Content -Path $filePath -Value "smoke test $unique"

try {
  Write-Host "Creating category ..."
  $category = Invoke-ApiJson -Method "Post" -Url "$ApiBase/admin/categories" -Headers $headers -Body @{
    name = $categoryName
  }

  Write-Host "Creating draft post ..."
  $draftPost = Invoke-ApiJson -Method "Post" -Url "$ApiBase/admin/posts" -Headers $headers -Body @{
    title = $draftTitle
    summary = "smoke draft"
    content = "draft content"
    category_id = $category.id
    status = "draft"
  }

  Write-Host "Checking draft visibility ..."
  $publicPosts = Invoke-RestMethod -Uri "$ApiBase/posts" -Method Get
  if ($publicPosts.data.title -contains $draftTitle) {
    throw "Draft leaked into public posts response."
  }

  $publicPostsWithAdminToken = Invoke-RestMethod -Uri "$ApiBase/posts" -Method Get -Headers $headers
  if ($publicPostsWithAdminToken.data.title -contains $draftTitle) {
    throw "Draft leaked into public posts response when admin token was attached."
  }

  $adminPosts = Invoke-RestMethod -Uri "$ApiBase/admin/posts?sort=admin" -Method Get -Headers $headers
  if (-not ($adminPosts.data.title -contains $draftTitle)) {
    throw "Draft is missing from admin posts response."
  }

  $publicDraftSearch = Invoke-RestMethod -Uri "$ApiBase/search?q=$([uri]::EscapeDataString($draftTitle))&scope=posts" -Method Get
  if ($publicDraftSearch.posts.title -contains $draftTitle) {
    throw "Draft leaked into public search response."
  }

  $adminDraftSearch = Invoke-RestMethod -Uri "$ApiBase/admin/search?q=$([uri]::EscapeDataString($draftTitle))&scope=posts" -Method Get -Headers $headers
  if (-not ($adminDraftSearch.posts.title -contains $draftTitle)) {
    throw "Draft is missing from admin search response."
  }

  $publicCategories = Invoke-RestMethod -Uri "$ApiBase/categories" -Method Get
  $adminCategories = Invoke-RestMethod -Uri "$ApiBase/admin/categories" -Method Get -Headers $headers
  $publicCategory = $publicCategories | Where-Object { $_.id -eq $category.id } | Select-Object -First 1
  $adminCategory = $adminCategories | Where-Object { $_.id -eq $category.id } | Select-Object -First 1
  if ($null -eq $publicCategory -or $null -eq $adminCategory) {
    throw "Category missing from category listing response."
  }
  if ($publicCategory.post_count -ne 0) {
    throw "Draft affected public category post count."
  }
  if ($adminCategory.post_count -lt 1) {
    throw "Draft missing from admin category post count."
  }

  Write-Host "Publishing post ..."
  $publishedPost = Invoke-ApiJson -Method "Put" -Url "$ApiBase/admin/posts/$($draftPost.id)" -Headers $headers -Body @{
    title = $publishedTitle
    summary = "smoke published"
    content = "published content"
    category_id = $category.id
    status = "published"
  }

  $publicPostsAfterPublish = Invoke-RestMethod -Uri "$ApiBase/posts" -Method Get
  if (-not ($publicPostsAfterPublish.data.title -contains $publishedTitle)) {
    throw "Published post did not appear in public posts response."
  }

  Write-Host "Uploading file ..."
  $upload = curl.exe -s -X POST "$ApiBase/admin/files" -H "Authorization: Bearer $($login.token)" -F "file=@$filePath"
  $uploadJson = $upload | ConvertFrom-Json
  if (-not $uploadJson.id) {
    throw "File upload failed."
  }

  $files = Invoke-RestMethod -Uri "$ApiBase/files" -Method Get
  if (-not ($files.data.orig_name -contains (Split-Path $filePath -Leaf))) {
    throw "Uploaded file did not appear in public files response."
  }

  $adminFiles = Invoke-RestMethod -Uri "$ApiBase/admin/files?include_system=true" -Method Get -Headers $headers
  if (-not ($adminFiles.data.orig_name -contains (Split-Path $filePath -Leaf))) {
    throw "Uploaded file did not appear in admin files response."
  }

  Write-Host "Deleting smoke data ..."
  Invoke-RestMethod -Uri "$ApiBase/admin/files/$($uploadJson.id)" -Method Delete -Headers $headers | Out-Null
  Invoke-RestMethod -Uri "$ApiBase/admin/posts/$($draftPost.id)" -Method Delete -Headers $headers | Out-Null
  Invoke-RestMethod -Uri "$ApiBase/admin/categories/$($category.id)" -Method Delete -Headers $headers | Out-Null

  Write-Host "Smoke test completed successfully."
}
finally {
  if (Test-Path $filePath) {
    Remove-Item $filePath -Force
  }
}
