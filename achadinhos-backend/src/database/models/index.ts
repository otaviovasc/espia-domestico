import { User } from './User'
import { Connection } from './Connection'
import { Campaign } from './Campaign'
import { CampaignLog } from './CampaignLog'
import { ProductGroupDelivery } from './ProductGroupDelivery'
import { ClassificationProfileRecord } from './ClassificationProfile'
import { ProductGroup } from './ProductGroup'
import { SavedProduct } from './SavedProduct'
import { SavedProductGroupMembership } from './SavedProductGroupMembership'
import { AdProject } from './AdProject'
import { AdAsset } from './AdAsset'
import { AdRenderJob } from './AdRenderJob'
import { GroupMessage } from './GroupMessage'
import { SmartAudience } from './SmartAudience'
import { SmartPlan } from './SmartPlan'
import { SmartSend } from './SmartSend'
import { SmartAIRequest } from './SmartAIRequest'

/**
 * Register model associations. Call once at boot before serving requests.
 */
export function registerAssociations(): void {
  User.hasMany(SmartAudience, { foreignKey: 'userId', as: 'smartAudiences' })
  SmartAudience.belongsTo(User, { foreignKey: 'userId', as: 'user' })
  User.hasMany(SmartPlan, { foreignKey: 'userId', as: 'smartPlans' })
  SmartPlan.belongsTo(User, { foreignKey: 'userId', as: 'user' })
  SmartPlan.hasMany(SmartSend, { foreignKey: 'planId', as: 'sends' })
  SmartSend.belongsTo(SmartPlan, { foreignKey: 'planId', as: 'plan' })
  User.hasMany(SmartSend, { foreignKey: 'userId', as: 'smartSends' })
  SmartSend.belongsTo(User, { foreignKey: 'userId', as: 'user' })
  User.hasMany(SmartAIRequest, { foreignKey: 'userId', as: 'smartAIRequests' })
  SmartAIRequest.belongsTo(User, { foreignKey: 'userId', as: 'user' })
  User.hasOne(Connection, { foreignKey: 'userId', as: 'connection' })
  Connection.belongsTo(User, { foreignKey: 'userId', as: 'user' })

  User.hasMany(Campaign, { foreignKey: 'userId', as: 'campaigns' })
  Campaign.belongsTo(User, { foreignKey: 'userId', as: 'user' })

  Campaign.hasMany(CampaignLog, { foreignKey: 'campaignId', as: 'logs' })
  CampaignLog.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' })

  User.hasMany(ProductGroupDelivery, { foreignKey: 'userId', as: 'productGroupDeliveries' })
  ProductGroupDelivery.belongsTo(User, { foreignKey: 'userId', as: 'user' })
  Campaign.hasMany(ProductGroupDelivery, { foreignKey: 'campaignId', as: 'productGroupDeliveries' })
  ProductGroupDelivery.belongsTo(Campaign, { foreignKey: 'campaignId', as: 'campaign' })

  User.hasMany(ClassificationProfileRecord, { foreignKey: 'userId', as: 'classificationProfiles' })
  ClassificationProfileRecord.belongsTo(User, { foreignKey: 'userId', as: 'user' })

  User.hasMany(ProductGroup, { foreignKey: 'userId', as: 'productGroups' })
  ProductGroup.belongsTo(User, { foreignKey: 'userId', as: 'user' })
  ProductGroup.belongsToMany(SavedProduct, {
    through: SavedProductGroupMembership,
    foreignKey: 'productGroupId',
    otherKey: 'savedProductId',
    as: 'products',
  })
  SavedProduct.belongsToMany(ProductGroup, {
    through: SavedProductGroupMembership,
    foreignKey: 'savedProductId',
    otherKey: 'productGroupId',
    as: 'productGroups',
  })

  User.hasMany(AdProject, { foreignKey: 'userId', as: 'adProjects' })
  AdProject.belongsTo(User, { foreignKey: 'userId', as: 'user' })
  AdProject.hasMany(AdAsset, { foreignKey: 'projectId', as: 'assets' })
  AdAsset.belongsTo(AdProject, { foreignKey: 'projectId', as: 'project' })
  AdProject.hasMany(AdRenderJob, { foreignKey: 'projectId', as: 'renderJobs' })
  AdRenderJob.belongsTo(AdProject, { foreignKey: 'projectId', as: 'project' })
}

export {
  User,
  Connection,
  Campaign,
  CampaignLog,
  ProductGroupDelivery,
  ClassificationProfileRecord,
  ProductGroup,
  SavedProduct,
  SavedProductGroupMembership,
  AdProject,
  AdAsset,
  AdRenderJob,
  GroupMessage,
  SmartAudience,
  SmartPlan,
  SmartSend,
  SmartAIRequest,
}
