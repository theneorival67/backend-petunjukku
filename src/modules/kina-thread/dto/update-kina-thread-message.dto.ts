import { PartialType } from '@nestjs/swagger';
import { CreateKinaThreadMessageDto } from './create-kina-thread-message.dto';

export class UpdateKinaThreadMessageDto extends PartialType(
  CreateKinaThreadMessageDto,
) {}
