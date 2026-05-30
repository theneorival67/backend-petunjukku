import { Prisma } from '@prisma/client';
import {
  INTRAKURIKULER_STAGE_META,
  emptyIntrakurikulerStageContent,
} from './schemas/intrakurikuler-stage-content';

export function buildIntrakurikulerStageSeed(): Prisma.RppStageCreateWithoutRppProjectInput[] {
  return INTRAKURIKULER_STAGE_META.map((meta) => {
    const content = emptyIntrakurikulerStageContent(meta.stageNumber);
    return {
      stageNumber: meta.stageNumber,
      stageName: meta.stageName,
      contentJson: content as Prisma.InputJsonObject,
      isCompleted: false,
    };
  });
}
