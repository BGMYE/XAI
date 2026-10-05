import { useMemo, useState } from "react";
import { ImageOff, Play } from "lucide-react";
import { mediaURL } from "./client";
import { resultAssetIDs } from "./jobResults.mjs";
import type { Asset, Job } from "./types";
import "./job-thumbnails.css";

export interface JobResultThumbnailsProps {
  job: Job;
  assets: Asset[];
  onOpen(asset: Asset): void;
}

function ResultThumbnail({ asset, index, onOpen, resultLabel }: {
  asset: Asset;
  index: number;
  resultLabel?: string;
  onOpen(asset: Asset): void;
}) {
  const source = mediaURL(asset.id);
  const [failedSource, setFailedSource] = useState<string>();
  const unavailable = !source || failedSource === source;
  const isVideo = asset.kind === "video";
  const label = resultLabel || `${isVideo ? "视频" : "图片"} ${index + 1}`;
  return (
    <button
      type="button"
      className="studio-job-thumbnail"
      onClick={() => onOpen(asset)}
      disabled={unavailable}
      aria-label={unavailable ? `${label}，本地文件不可用：${asset.name}` : `打开生成${label}：${asset.name}`}
      title={unavailable ? "本地文件不可用" : `查看原作品：${asset.name}`}
    >
      <span className="studio-job-thumbnail-media">
        {unavailable ? (
          <span className="studio-job-thumbnail-unavailable">
            <ImageOff size={24} aria-hidden="true" />
            <span>本地文件不可用</span>
          </span>
        ) : isVideo ? (
          <>
            <video
              src={source}
              preload="metadata"
              muted
              playsInline
              tabIndex={-1}
              aria-hidden="true"
              onError={() => setFailedSource(source)}
            />
            <span className="studio-job-thumbnail-play" aria-hidden="true"><Play size={20} fill="currentColor" /></span>
          </>
        ) : (
          <img src={source} alt="" loading="lazy" decoding="async" onError={() => setFailedSource(source)} />
        )}
      </span>
      <span className="studio-job-thumbnail-label">{label}</span>
    </button>
  );
}

/** Only local final-result IDs qualify; reference images and remote URLs do not. */
export function JobResultThumbnails({ job, assets, onOpen }: JobResultThumbnailsProps) {
  const results = useMemo(() => {
    const byID = new Map(assets.filter((asset) => !asset.deletedAt).map((asset) => [asset.id, asset]));
    return resultAssetIDs(job).flatMap((id) => {
      const asset = byID.get(id);
      return asset ? [asset] : [];
    });
  }, [assets, job.resultAssetId, job.resultAssetIds, job.resultImages, job.dlss5?.resultAssetId]);

  if (!results.length) return null;
  return (
    <div className="studio-job-thumbnails" role="group" aria-label="生成结果缩略图">
      {results.map((asset, index) => <ResultThumbnail key={asset.id} asset={asset} index={index} onOpen={onOpen} resultLabel={asset.kind === "video" && job.dlss5 ? (asset.id === job.dlss5.resultAssetId ? "增强成片" : "原视频") : undefined} />)}
    </div>
  );
}
