import { injectable } from 'tsyringe'
import type {
  ClassificationProfile,
  ClassificationProfileInput,
} from '@/dtos/classificationProfile'
import { DEFAULT_CLASSIFICATION_PROFILE } from '@/dtos/classificationProfile'
import { ClassificationProfileRecord } from '@/database/models/ClassificationProfile'
import { sequelize } from '@/database'
import { BadRequestError, NotFoundError } from '@/middleware/Error/AppError'

function serialize(record: ClassificationProfileRecord): ClassificationProfile {
  return {
    id: String(record.id),
    name: record.name,
    nicheDescription: record.nicheDescription,
    relevanceInstructions: record.relevanceInstructions,
    weights: record.weights,
    discountCap: record.discountCap,
    commissionCap: record.commissionCap,
    thresholds: record.thresholds,
    builtIn: false,
  }
}

function numericProfileId(id: string): number {
  if (!/^[1-9]\d*$/.test(id)) throw NotFoundError('Perfil de classificação não encontrado')
  const parsed = Number(id)
  if (!Number.isSafeInteger(parsed)) throw NotFoundError('Perfil de classificação não encontrado')
  return parsed
}

@injectable()
export class ClassificationProfileService {
  async list(userId: number): Promise<ClassificationProfile[]> {
    const records = await ClassificationProfileRecord.findAll({
      where: { userId },
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
    })
    return [DEFAULT_CLASSIFICATION_PROFILE, ...records.map(serialize)]
  }

  async getForUser(userId: number, id: string): Promise<ClassificationProfile> {
    if (id === DEFAULT_CLASSIFICATION_PROFILE.id) return DEFAULT_CLASSIFICATION_PROFILE
    const record = await ClassificationProfileRecord.findOne({
      where: { id: numericProfileId(id), userId },
    })
    if (!record) throw NotFoundError('Perfil de classificação não encontrado')
    return serialize(record)
  }

  async create(userId: number, input: ClassificationProfileInput): Promise<ClassificationProfile> {
    return serialize(await ClassificationProfileRecord.create({ userId, ...input }))
  }

  async update(
    userId: number,
    id: string,
    input: ClassificationProfileInput,
  ): Promise<ClassificationProfile> {
    if (id === DEFAULT_CLASSIFICATION_PROFILE.id) {
      throw BadRequestError('O perfil padrão não pode ser alterado')
    }
    return sequelize.transaction(async (transaction) => {
      const record = await ClassificationProfileRecord.findOne({
        where: { id: numericProfileId(id), userId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!record) throw NotFoundError('Perfil de classificação não encontrado')
      await record.update(input, { transaction })

      // Ratings retain a name snapshot so they remain understandable after a
      // profile is deleted. While it exists, keep that snapshot current on rename.
      await sequelize.query(
        `UPDATE saved_products
         SET classifications = jsonb_set(
               classifications,
               ARRAY[:profileId, 'profileName']::text[],
               to_jsonb(CAST(:profileName AS text)),
               true
             ),
             offer = CASE
               WHEN offer->>'classificationProfileId' = :profileId
               THEN jsonb_set(
                 offer,
                 '{classificationProfileName}',
                 to_jsonb(CAST(:profileName AS text)),
                 true
               )
               ELSE offer
             END,
             updated_at = NOW()
         WHERE user_id = :userId AND classifications ? :profileId`,
        {
          replacements: { profileId: id, profileName: input.name, userId },
          transaction,
        },
      )
      return serialize(record)
    })
  }

  async remove(userId: number, id: string): Promise<void> {
    if (id === DEFAULT_CLASSIFICATION_PROFILE.id) {
      throw BadRequestError('O perfil padrão não pode ser removido')
    }
    const removed = await ClassificationProfileRecord.destroy({
      where: { id: numericProfileId(id), userId },
    })
    if (!removed) throw NotFoundError('Perfil de classificação não encontrado')
  }
}
