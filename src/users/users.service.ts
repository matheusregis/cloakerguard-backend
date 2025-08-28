import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { Model } from 'mongoose';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async create(
    email: string,
    name: string,
    lastName: string,
    hashedPassword: string,
  ): Promise<UserDocument> {
    const createdUser = new this.userModel({
      email,
      name,
      lastName,
      password: hashedPassword,
    }) as UserDocument;

    return createdUser.save();
  }
}
