import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize'
import { sequelize } from '@/database'
import type { AdProjectConfig } from '@/dtos/adProject'

export const AD_RENDER_JOB_STATUS = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const
export type AdRenderJobStatus = (typeof AD_RENDER_JOB_STATUS)[number]

export interface AdRenderOutput {
  index: number
  fileName: string
  storagePath: string
  sizeBytes: number
  durationSeconds: number
  seed: string
  cutTimes: number[]
  timingSource: 'beat' | 'fixed' | 'fallback'
  clipAssetIds: number[]
  textOrder: string[]
}

export class AdRenderJob extends Model<
  InferAttributes<AdRenderJob>,
  InferCreationAttributes<AdRenderJob>
> {
  declare id: CreationOptional<number>
  declare projectId: number
  declare status: CreationOptional<AdRenderJobStatus>
  declare progress: CreationOptional<number>
  declare configSnapshot: AdProjectConfig
  declare outputs: CreationOptional<AdRenderOutput[]>
  declare error: CreationOptional<string | null>
  declare workerId: CreationOptional<string | null>
  declare heartbeatAt: CreationOptional<Date | null>
  declare startedAt: CreationOptional<Date | null>
  declare finishedAt: CreationOptional<Date | null>
  declare createdAt: CreationOptional<Date>
  declare updatedAt: CreationOptional<Date>
}

AdRenderJob.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    projectId: { type: DataTypes.INTEGER, allowNull: false, field: 'project_id' },
    status: { type: DataTypes.ENUM(...AD_RENDER_JOB_STATUS), allowNull: false, defaultValue: 'queued' },
    progress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    configSnapshot: { type: DataTypes.JSONB, allowNull: false, field: 'config_snapshot' },
    outputs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    error: { type: DataTypes.TEXT, allowNull: true },
    workerId: { type: DataTypes.STRING(80), allowNull: true, field: 'worker_id' },
    heartbeatAt: { type: DataTypes.DATE, allowNull: true, field: 'heartbeat_at' },
    startedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
    finishedAt: { type: DataTypes.DATE, allowNull: true, field: 'finished_at' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  },
  { sequelize, tableName: 'ad_render_jobs', underscored: true },
)
