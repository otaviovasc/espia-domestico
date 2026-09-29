import { User } from './User'
import { Connection } from './Connection'
import { Campaign } from './Campaign'
import { CampaignLog } from './CampaignLog'
import { ProductGroupDelivery } from './ProductGroupDelivery'

/**
 * Register model associations. Call once at boot before serving requests.
 */
export function registerAssociations(): void {
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
}

export { User, Connection, Campaign, CampaignLog, ProductGroupDelivery }
