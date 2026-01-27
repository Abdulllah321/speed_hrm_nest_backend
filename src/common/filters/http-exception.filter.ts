import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';

interface ErrorResponse {
  status: boolean;
  message: string;
  errors?: any;
  statusCode?: number;
  timestamp?: string;
  path?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let errorResponse: ErrorResponse = {
      status: false,
      message: 'An unexpected error occurred',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Handle HTTP Exceptions (from NestJS)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        errorResponse = {
          status: false,
          message: exceptionResponse,
          statusCode: status,
          timestamp: new Date().toISOString(),
          path: request.url,
        };
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        errorResponse = {
          status: false,
          message:
            responseObj.message || exception.message || 'An error occurred',
          errors: responseObj.errors || undefined,
          statusCode: status,
          timestamp: new Date().toISOString(),
          path: request.url,
        };
      }

      // Log the error
      if (status === HttpStatus.UNAUTHORIZED) {
        this.logger.warn(
          `HTTP ${status} Warning: ${errorResponse.message} - ${request.method} ${request.url}`,
        );
      } else {
        this.logger.error(
          `HTTP ${status} Error: ${errorResponse.message}`,
          exception.stack,
          `${request.method} ${request.url}`,
        );
      }

      return response.status(status).send(errorResponse);
    }

    // Handle Prisma Errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      errorResponse = this.handlePrismaError(exception, request.url);
      this.logger.error(
        `Prisma Error: ${errorResponse.message}`,
        exception.stack,
        `${request.method} ${request.url}`,
      );
      return response
        .status(errorResponse.statusCode || HttpStatus.BAD_REQUEST)
        .send(errorResponse);
    }

    // Handle Prisma Validation Errors
    if (exception instanceof Prisma.PrismaClientValidationError) {
      errorResponse = {
        status: false,
        message:
          'Invalid data provided. Please check your input and try again.',
        statusCode: HttpStatus.BAD_REQUEST,
        timestamp: new Date().toISOString(),
        path: request.url,
      };
      this.logger.error(
        `Prisma Validation Error: ${exception.message}`,
        exception.stack,
        `${request.method} ${request.url}`,
      );
      return response.status(HttpStatus.BAD_REQUEST).send(errorResponse);
    }

    // Handle Prisma Client Initialization Errors
    if (exception instanceof Prisma.PrismaClientInitializationError) {
      errorResponse = {
        status: false,
        message: 'Database connection error. Please try again later.',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        timestamp: new Date().toISOString(),
        path: request.url,
      };
      this.logger.error(
        `Prisma Initialization Error: ${exception.message}`,
        exception.stack,
        `${request.method} ${request.url}`,
      );
      return response
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .send(errorResponse);
    }

    // Handle Prisma Client Unknown Errors
    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      errorResponse = {
        status: false,
        message: 'A database error occurred. Please try again later.',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: new Date().toISOString(),
        path: request.url,
      };
      this.logger.error(
        `Prisma Unknown Error: ${exception.message}`,
        exception.stack,
        `${request.method} ${request.url}`,
      );
      return response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send(errorResponse);
    }

    // Handle Prisma Client RPC Errors
    if (exception instanceof Prisma.PrismaClientRustPanicError) {
      errorResponse = {
        status: false,
        message: 'A database error occurred. Please try again later.',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: new Date().toISOString(),
        path: request.url,
      };
      this.logger.error(
        `Prisma Rust Panic Error: ${exception.message}`,
        exception.stack,
        `${request.method} ${request.url}`,
      );
      return response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send(errorResponse);
    }

    // Handle generic errors
    if (exception instanceof Error) {
      errorResponse = {
        status: false,
        message: exception.message || 'An unexpected error occurred',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        timestamp: new Date().toISOString(),
        path: request.url,
      };
      this.logger.error(
        `Unexpected Error: ${exception.message}`,
        exception.stack,
        `${request.method} ${request.url}`,
      );
      return response
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send(errorResponse);
    }

    // Fallback for unknown error types
    this.logger.error(
      'Unknown Error',
      JSON.stringify(exception),
      `${request.method} ${request.url}`,
    );

    return response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send(errorResponse);
  }

  private handlePrismaError(
    error: Prisma.PrismaClientKnownRequestError,
    path: string,
  ): ErrorResponse {
    const baseResponse: Omit<ErrorResponse, 'message'> = {
      status: false,
      statusCode: HttpStatus.BAD_REQUEST,
      timestamp: new Date().toISOString(),
      path,
    };

    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[]) || [];
        const field = target[0] || 'field';
        return {
          ...baseResponse,
          message: `A record with this ${this.formatFieldName(field)} already exists. Please use a different value.`,
        };
      }

      case 'P2003':
        // Foreign key constraint violation
        return {
          ...baseResponse,
          message:
            'The operation failed because it references a record that does not exist.',
        };

      case 'P2025':
        // Record not found
        return {
          ...baseResponse,
          message: 'The requested record was not found.',
          statusCode: HttpStatus.NOT_FOUND,
        };

      case 'P2014':
        // Required relation violation
        return {
          ...baseResponse,
          message:
            'The operation failed because a required relation is missing.',
        };

      case 'P2000':
        // Input value too long
        return {
          ...baseResponse,
          message:
            'The provided value is too long. Please provide a shorter value.',
        };

      case 'P2001':
        // Record does not exist
        return {
          ...baseResponse,
          message: 'The requested record does not exist.',
          statusCode: HttpStatus.NOT_FOUND,
        };

      case 'P2011':
        // Null constraint violation
        return {
          ...baseResponse,
          message:
            'A required field is missing. Please provide all required information.',
        };

      case 'P2012':
        // Missing required value
        return {
          ...baseResponse,
          message:
            'A required value is missing. Please check your input and try again.',
        };

      case 'P2013':
        // Missing required argument
        return {
          ...baseResponse,
          message:
            'A required argument is missing. Please provide all required information.',
        };

      case 'P2015':
        // Related record not found
        return {
          ...baseResponse,
          message:
            'A related record was not found. Please check your input and try again.',
        };

      case 'P2016':
        // Query interpretation error
        return {
          ...baseResponse,
          message: 'Invalid query. Please check your request and try again.',
        };

      case 'P2017':
        // Records for relation not connected
        return {
          ...baseResponse,
          message:
            'The records are not properly connected. Please check your input.',
        };

      case 'P2018':
        // Required connected records not found
        return {
          ...baseResponse,
          message:
            'Required connected records were not found. Please check your input.',
        };

      case 'P2019':
        // Input error
        return {
          ...baseResponse,
          message:
            'Invalid input provided. Please check your data and try again.',
        };

      case 'P2020':
        // Value out of range
        return {
          ...baseResponse,
          message:
            'The provided value is out of range. Please provide a valid value.',
        };

      case 'P2021':
        // Table does not exist
        return {
          ...baseResponse,
          message: 'Database table not found. Please contact support.',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        };

      case 'P2022':
        // Column does not exist
        return {
          ...baseResponse,
          message: 'Database column not found. Please contact support.',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        };

      case 'P2023':
        // Inconsistent column data
        return {
          ...baseResponse,
          message:
            'Database data inconsistency detected. Please contact support.',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        };

      case 'P2024':
        // Connection timeout
        return {
          ...baseResponse,
          message: 'Database connection timed out. Please try again later.',
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        };

      case 'P2027':
        // Multiple errors occurred
        return {
          ...baseResponse,
          message:
            'Multiple errors occurred. Please check your input and try again.',
        };

      case 'P2028':
        // Transaction API error
        return {
          ...baseResponse,
          message: 'Transaction error. Please try again.',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        };

      case 'P2030':
        // Fulltext index not found
        return {
          ...baseResponse,
          message: 'Search index not found. Please contact support.',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        };

      case 'P2031':
        // MongoDB chunk error
        return {
          ...baseResponse,
          message: 'Database chunk error. Please try again.',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        };

      case 'P2033':
        // Invalid number of arguments
        return {
          ...baseResponse,
          message:
            'Invalid number of arguments provided. Please check your request.',
        };

      case 'P2034':
        // Transaction conflict
        return {
          ...baseResponse,
          message: 'Transaction conflict. Please try again.',
          statusCode: HttpStatus.CONFLICT,
        };

      default:
        return {
          ...baseResponse,
          message: 'A database error occurred. Please try again later.',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        };
    }
  }

  private formatFieldName(field: string): string {
    // Convert camelCase or snake_case to readable format
    return field
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .toLowerCase()
      .trim();
  }
}
