export type AssetSourceType =
  | "local"
  | "remote"
  | "generated"
  | "user_owned"
  | "project_asset";

export type AssetRightsStatus = "approved" | "pending" | "blocked" | "unknown";

export type AssetUploadStatus =
  | "not_uploaded"
  | "pending"
  | "uploaded"
  | "failed";

export interface AssetTransformation {
  type: "copy" | "reencode" | "resize" | "privacy_cleanup" | "cover_crop";
  input_sha256: string;
  output_sha256: string;
  output_path: string;
  mime_type: string;
  file_size: number;
  width: number;
  height: number;
  privacy_metadata_removed: boolean;
  created_at: string;
}

export interface AssetBuildOutput {
  output_id: string;
  purpose: "article" | "cover_preview";
  path: string;
  sha256: string;
  mime_type: string;
  file_size: number;
  width: number;
  height: number;
}

export interface AssetManifestEntry {
  asset_id: string;
  original_reference: string;
  local_path: string;
  normalized_path: string;
  source_type: AssetSourceType;
  source_url: string | null;
  sha256: string;
  mime_type: string;
  file_size: number;
  width: number;
  height: number;
  animated: boolean;
  has_alpha: boolean;
  exif_present: boolean;
  gps_metadata_present: boolean;
  imported_at: string;
  imported_by: string;
  rights_status: AssetRightsStatus;
  license: string | null;
  creator: string | null;
  attribution: string | null;
  generation_method?: string | null;
  transformations: AssetTransformation[];
  build_outputs: AssetBuildOutput[];
  upload_status: AssetUploadStatus;
  warnings: string[];
}

export interface AssetManifest {
  schema_version: "1";
  article_id: string;
  generated_at: string;
  assets: AssetManifestEntry[];
}

export interface AssetRightsInput {
  rightsStatus?: AssetRightsStatus;
  /** Required whenever an import is immediately marked rights_status=approved. */
  rightsConfirmedByHuman?: true;
  license?: string | null;
  creator?: string | null;
  attribution?: string | null;
  /** Required before source_type=user_owned is recorded. */
  userOwnedConfirmed?: true;
  /** Required for generated assets so the generation source remains auditable. */
  generationMethod?: string;
}

export interface AssetImportMetadata extends AssetRightsInput {
  sourceType?: AssetSourceType;
  importedBy: string;
  sourceUrl?: string;
}

export interface MediaSecurityPolicy {
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
}

export interface InspectedImage {
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  animated: boolean;
  hasAlpha: boolean;
  exifPresent: boolean;
  gpsMetadataPresent: boolean;
  extensionMatches: boolean;
  warnings: string[];
}

export interface ManifestValidationIssue {
  code: string;
  message: string;
  assetId?: string;
  blocking: boolean;
}

export interface RightsVerificationResult {
  publishReady: boolean;
  issues: ManifestValidationIssue[];
}
