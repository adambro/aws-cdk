import '@aws-cdk/assert-internal/jest';
import { ABSENT, ResourcePart, anything, arrayWith } from '@aws-cdk/assert-internal';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as firehose from '@aws-cdk/aws-kinesisfirehose';
import * as kms from '@aws-cdk/aws-kms';
import * as lambda from '@aws-cdk/aws-lambda';
import * as logs from '@aws-cdk/aws-logs';
import * as redshift from '@aws-cdk/aws-redshift';
import * as s3 from '@aws-cdk/aws-s3';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as cdk from '@aws-cdk/core';
import * as dests from '../lib';

describe('redshift destination', () => {
  let stack: cdk.Stack;
  let vpc: ec2.Vpc;
  let cluster: redshift.ICluster;

  const minimalProps = {
    user: { username: 'firehose' },
    database: 'database',
    tableName: 'tableName',
    tableColumns: [{ name: 'col1', dataType: 'varchar(4)' }, { name: 'col2', dataType: 'float' }],
  };

  beforeEach(() => {
    stack = new cdk.Stack();
    vpc = new ec2.Vpc(stack, 'VPC');
    cluster = new redshift.Cluster(stack, 'Cluster', {
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      masterUser: {
        masterUsername: 'master',
      },
      publiclyAccessible: true,
    });
  });

  it('produces config when minimally specified', () => {
    const destination = new dests.RedshiftCluster(cluster, {
      ...minimalProps,
    });

    new firehose.DeliveryStream(stack, 'Delivery Stream', {
      destinations: [destination],
    });

    expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
      RedshiftDestinationConfiguration: {
        ClusterJDBCURL: {
          'Fn::Join': [
            '',
            [
              'jdbc:redshift://',
              {
                'Fn::GetAtt': [
                  'ClusterEB0386A7',
                  'Endpoint.Address',
                ],
              },
              ':',
              {
                'Fn::GetAtt': [
                  'ClusterEB0386A7',
                  'Endpoint.Port',
                ],
              },
              '/database',
            ],
          ],
        },
        CopyCommand: {
          DataTableName: 'tableName',
          DataTableColumns: 'col1,col2',
        },
        Username: {
          Ref: 'DeliveryStreamFirehoseRedshiftUserC8F69480',
        },
        Password: {
          'Fn::Join': [
            '',
            [
              '{{resolve:secretsmanager:',
              { Ref: 'DeliveryStreamFirehoseUserSecretAttachment5554E12B' },
              ':SecretString:password::}}',
            ],
          ],
        },
        RoleARN: { 'Fn::GetAtt': ['DeliveryStreamRedshiftDestinationRole4E4B5469', 'Arn'] },
        S3Configuration: {
          BucketARN: { 'Fn::GetAtt': ['DeliveryStreamIntermediateBucket96CB3206', 'Arn'] },
          RoleARN: { 'Fn::GetAtt': ['DeliveryStreamRedshiftDestinationRole4E4B5469', 'Arn'] },
        },
      },
    });
  });

  it('produces config when fully specified', () => {
    const processorFunctionArn = 'arn:aws:lambda:xx-west-1:111122223333:function:my-function';
    const processorFunction = lambda.Function.fromFunctionAttributes(stack, 'Processor', {
      functionArn: processorFunctionArn,
      sameEnvironment: true,
    });
    const destinationRoleArn = 'arn:aws:iam::111122223333:role/manual-destination-role';
    const destinationRole = iam.Role.fromRoleArn(stack, 'Redshift Destination Role', destinationRoleArn);
    const destination = new dests.RedshiftCluster(cluster, {
      ...minimalProps,
      copyOptions: 'json \'auto\'',
      role: destinationRole,
      retryTimeout: cdk.Duration.minutes(2),
      bufferingInterval: cdk.Duration.minutes(1),
      bufferingSize: cdk.Size.mebibytes(1),
      compression: dests.Compression.GZIP,
      logging: true,
      processor: new firehose.LambdaFunctionProcessor(processorFunction),
      s3Backup: {
        mode: dests.BackupMode.ALL,
      },
    });

    new firehose.DeliveryStream(stack, 'Delivery Stream', {
      destinations: [destination],
    });

    expect(stack).toHaveResource('AWS::KinesisFirehose::DeliveryStream', {
      RedshiftDestinationConfiguration: {
        ClusterJDBCURL: {
          'Fn::Join': [
            '',
            [
              'jdbc:redshift://',
              {
                'Fn::GetAtt': [
                  'ClusterEB0386A7',
                  'Endpoint.Address',
                ],
              },
              ':',
              {
                'Fn::GetAtt': [
                  'ClusterEB0386A7',
                  'Endpoint.Port',
                ],
              },
              '/database',
            ],
          ],
        },
        CopyCommand: {
          CopyOptions: 'json \'auto\' gzip',
          DataTableName: 'tableName',
          DataTableColumns: 'col1,col2',
        },
        Username: {
          Ref: 'DeliveryStreamFirehoseRedshiftUserC8F69480',
        },
        Password: {
          'Fn::Join': [
            '',
            [
              '{{resolve:secretsmanager:',
              { Ref: 'DeliveryStreamFirehoseUserSecretAttachment5554E12B' },
              ':SecretString:password::}}',
            ],
          ],
        },
        RoleARN: destinationRoleArn,
        S3Configuration: {
          BucketARN: { 'Fn::GetAtt': ['DeliveryStreamIntermediateBucket96CB3206', 'Arn'] },
          RoleARN: destinationRoleArn,
          CompressionFormat: 'GZIP',
          BufferingHints: {
            IntervalInSeconds: 60,
            SizeInMBs: 1,
          },
          CloudWatchLoggingOptions: {
            Enabled: true,
            LogGroupName: { Ref: 'DeliveryStreamLogGroup9D8FA3BB' },
            LogStreamName: { Ref: 'DeliveryStreamLogGroupIntermediateS36D6EECFE' },
          },
        },
        S3BackupMode: 'Enabled',
        S3BackupConfiguration: {
          BucketARN: { 'Fn::GetAtt': ['DeliveryStreamBackupBucket0C646C83', 'Arn'] },
          RoleARN: destinationRoleArn,
          CloudWatchLoggingOptions: {
            Enabled: true,
            LogGroupName: { Ref: 'DeliveryStreamLogGroup9D8FA3BB' },
            LogStreamName: { Ref: 'DeliveryStreamLogGroupS3BackupD5DF41B2' },
          },
        },
        CloudWatchLoggingOptions: {
          Enabled: true,
          LogGroupName: { Ref: 'DeliveryStreamLogGroup9D8FA3BB' },
          LogStreamName: { Ref: 'DeliveryStreamLogGroupRedshift84E27601' },
        },
        ProcessingConfiguration: {
          Enabled: true,
          Processors: [{
            Parameters: [
              { ParameterName: 'RoleArn', ParameterValue: destinationRoleArn },
              { ParameterName: 'LambdaArn', ParameterValue: processorFunctionArn },
            ],
            Type: 'Lambda',
          }],
        },
        RetryOptions: {
          DurationInSeconds: 120,
        },
      },
    });
  });

  describe('master secret', () => {
    it('uses master secret if provided', () => {
      cluster = new redshift.Cluster(stack, 'Cluster With Provided Master Secret', {
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        masterUser: {
          masterUsername: 'master',
          masterPassword: cdk.SecretValue.plainText('INSECURE_NOT_FOR_PRODUCTION'),
        },
        publiclyAccessible: true,
      });
      const destination = new dests.RedshiftCluster(cluster, {
        masterSecret: secretsmanager.Secret.fromSecretNameV2(stack, 'Imported Master Secret', 'imported-master-secret'),
        ...minimalProps,
      });

      new firehose.DeliveryStream(stack, 'Delivery Stream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            masterSecretArn: {
              'Fn::Join': [
                '',
                [
                  'arn:',
                  {
                    Ref: 'AWS::Partition',
                  },
                  ':secretsmanager:',
                  {
                    Ref: 'AWS::Region',
                  },
                  ':',
                  {
                    Ref: 'AWS::AccountId',
                  },
                  ':secret:imported-master-secret',
                ],
              ],
            },
          },
        },
      });
    });

    it('throws error if master secret not provided and cluster was provided a master password', () => {
      cluster = new redshift.Cluster(stack, 'Cluster With Provided Master Secret', {
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        masterUser: {
          masterUsername: 'master',
          masterPassword: cdk.SecretValue.plainText('INSECURE_NOT_FOR_PRODUCTION'),
        },
        publiclyAccessible: true,
      });

      expect(() => new dests.RedshiftCluster(cluster, {
        ...minimalProps,
      })).toThrowError('Master secret must be provided or Redshift cluster must generate a master secret');
    });

    it('throws error if master secret not provided and cluster was imported', () => {
      const subnetGroup = new redshift.ClusterSubnetGroup(stack, 'Cluster Subnet Group', {
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        description: '',
      });
      cluster = redshift.Cluster.fromClusterAttributes(stack, 'Imported Cluster', {
        clusterName: 'imported-cluster',
        clusterEndpointAddress: 'imported-cluster.abcdefghijk.xx-west-1.redshift.amazonaws.com',
        clusterEndpointPort: 5439,
        publiclyAccessible: true,
        subnetGroup,
      });

      expect(() => new dests.RedshiftCluster(cluster, {
        ...minimalProps,
      })).toThrowError('Master secret must be provided or Redshift cluster must generate a master secret');
    });
  });

  describe('public cluster', () => {
    it('throws error if cluster not publicly accessible', () => {
      cluster = new redshift.Cluster(stack, 'Cluster Not Publicly Accessible', {
        vpc: vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        masterUser: {
          masterUsername: 'master',
        },
        publiclyAccessible: false,
      });

      expect(() => new dests.RedshiftCluster(cluster, {
        ...minimalProps,
      })).toThrowError('Redshift cluster used as Firehose destination must be publicly accessible');
    });

    it('throws error if cluster not in public subnet', () => {
      cluster = new redshift.Cluster(stack, 'Cluster Not Publicly Accessible', {
        vpc: vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE,
        },
        masterUser: {
          masterUsername: 'master',
        },
        publiclyAccessible: true,
      });

      expect(() => new dests.RedshiftCluster(cluster, {
        ...minimalProps,
      })).toThrowError('Redshift cluster used as Firehose destination must be located in a public subnet');
    });
  });

  it('uses provided intermediate bucket and access role', () => {
    const intermediateBucket = s3.Bucket.fromBucketName(stack, 'Manual Intermediate Bucket', 'manual-intermediate-bucket');
    const intermediateBucketAccessRole = iam.Role.fromRoleArn(stack, 'Manual Intermediate Bucket Access Role', 'arn:aws:iam::111122223333:role/manual-intermediate-access-role');
    const destination = new dests.RedshiftCluster(cluster, {
      ...minimalProps,
      intermediateBucket: intermediateBucket,
      bucketAccessRole: intermediateBucketAccessRole,
    });

    new firehose.DeliveryStream(stack, 'Delivery Stream', {
      destinations: [destination],
    });

    expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
      RedshiftDestinationConfiguration: {
        S3Configuration: {
          BucketARN: {
            'Fn::Join': [
              '',
              [
                'arn:',
                {
                  Ref: 'AWS::Partition',
                },
                ':s3:::manual-intermediate-bucket',
              ],
            ],
          },
        },
      },
    });
    expect(stack).toHaveResourceLike('AWS::Redshift::Cluster', {
      IamRoles: [],
    });
    expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: [
              's3:GetObject*',
              's3:GetBucket*',
              's3:List*',
            ],
            Resource: [
              {
                'Fn::Join': [
                  '',
                  [
                    'arn:',
                    {
                      Ref: 'AWS::Partition',
                    },
                    ':s3:::manual-intermediate-bucket',
                  ],
                ],
              },
              {
                'Fn::Join': [
                  '',
                  [
                    'arn:',
                    {
                      Ref: 'AWS::Partition',
                    },
                    ':s3:::manual-intermediate-bucket/*',
                  ],
                ],
              },
            ],
          },
        ],
      },
      Roles: ['manual-intermediate-access-role'],
    });
  });

  describe('cluster user', () => {
    it('uses provided cluster user password', () => {
      const clusterUserPassword = cdk.SecretValue.plainText('INSECURE_NOT_FOR_PRODUCTION');
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        user: { username: 'firehose', password: clusterUserPassword },
      });

      new firehose.DeliveryStream(stack, 'Delivery Stream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          Password: 'INSECURE_NOT_FOR_PRODUCTION',
        },
      });
    });

    it('creates cluster user using custom resource', () => {
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
      });

      new firehose.DeliveryStream(stack, 'Delivery Stream', {
        destinations: [destination],
      });

      expect(stack).toHaveResource('Custom::FirehoseRedshiftUser');
    });
  });

  describe('cluster table', () => {
    it('creates cluster table using custom resource', () => {
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
      });

      new firehose.DeliveryStream(stack, 'Delivery Stream', {
        destinations: [destination],
      });

      expect(stack).toHaveResource('Custom::FirehoseRedshiftTable');
    });
  });

  it('validates retryTimeout', () => {
    expect(() => new dests.RedshiftCluster(cluster, {
      ...minimalProps,
      retryTimeout: cdk.Duration.hours(3),
    })).toThrowError('Retry timeout must be less that 2 hours');
  });

  it('validates compression', () => {
    expect(() => new dests.RedshiftCluster(cluster, {
      ...minimalProps,
      compression: dests.Compression.SNAPPY,
    })).toThrowError('Compression must not be HADOOP_SNAPPY, SNAPPY, or ZIP');
    expect(() => new dests.RedshiftCluster(cluster, {
      ...minimalProps,
      compression: dests.Compression.HADOOP_SNAPPY,
    })).toThrowError('Compression must not be HADOOP_SNAPPY, SNAPPY, or ZIP');
    expect(() => new dests.RedshiftCluster(cluster, {
      ...minimalProps,
      compression: dests.Compression.ZIP,
    })).toThrowError('Compression must not be HADOOP_SNAPPY, SNAPPY, or ZIP');
  });

  describe('logging', () => {
    it('creates resources and configuration by default', () => {
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
      });

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResource('AWS::Logs::LogGroup');
      expect(stack).toHaveResource('AWS::Logs::LogStream');
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          CloudWatchLoggingOptions: {
            Enabled: true,
            LogGroupName: anything(),
            LogStreamName: anything(),
          },
        },
      });
    });

    it('does not create resources or configuration if disabled', () => {
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        logging: false,
      });

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).not.toHaveResource('AWS::Logs::LogGroup');
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          CloudWatchLoggingOptions: ABSENT,
        },
      });
    });

    it('uses provided log group', () => {
      const logGroup = new logs.LogGroup(stack, 'Log Group');
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        logGroup,
      });

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toCountResources('AWS::Logs::LogGroup', 1);
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          CloudWatchLoggingOptions: {
            Enabled: true,
            LogGroupName: stack.resolve(logGroup.logGroupName),
            LogStreamName: anything(),
          },
        },
      });
    });

    it('throws error if logging disabled but log group provided', () => {
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        logging: false,
        logGroup: new logs.LogGroup(stack, 'Log Group'),
      });

      expect(() => new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      })).toThrowError('logging cannot be set to false when logGroup is provided');
    });

    it('grants log group write permissions to destination role', () => {
      const logGroup = new logs.LogGroup(stack, 'Log Group');
      const destinationRole = new iam.Role(stack, 'Redshift Destination Role', {
        assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      });
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        logGroup,
        role: destinationRole,
      });

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
        Roles: [stack.resolve(destinationRole.roleName)],
        PolicyDocument: {
          Statement: arrayWith(
            {
              Action: [
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              Effect: 'Allow',
              Resource: stack.resolve(logGroup.logGroupArn),
            },
          ),
        },
      });
    });
  });

  describe('processing configuration', () => {
    let destinationRole: iam.Role;
    let lambdaFunction: lambda.Function;
    let basicLambdaProcessor: firehose.LambdaFunctionProcessor;
    let destinationWithBasicLambdaProcessor: dests.RedshiftCluster;

    beforeEach(() => {
      destinationRole = new iam.Role(stack, 'Redshift Destination Role', {
        assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      });
      lambdaFunction = new lambda.Function(stack, 'DataProcessorFunction', {
        runtime: lambda.Runtime.NODEJS_12_X,
        code: lambda.Code.fromInline('foo'),
        handler: 'bar',
      });
      basicLambdaProcessor = new firehose.LambdaFunctionProcessor(lambdaFunction);
      destinationWithBasicLambdaProcessor = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        role: destinationRole,
        processor: basicLambdaProcessor,
      });
    });

    it('creates configuration for LambdaFunctionProcessor', () => {
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destinationWithBasicLambdaProcessor],
      });

      expect(stack).toHaveResource('AWS::Lambda::Function');
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          ProcessingConfiguration: {
            Enabled: true,
            Processors: [{
              Type: 'Lambda',
              Parameters: [
                {
                  ParameterName: 'RoleArn',
                  ParameterValue: stack.resolve(destinationRole.roleArn),
                },
                {
                  ParameterName: 'LambdaArn',
                  ParameterValue: stack.resolve(lambdaFunction.functionArn),
                },
              ],
            }],
          },
        },
      });
    });

    it('set all optional parameters', () => {
      const processor = new firehose.LambdaFunctionProcessor(lambdaFunction, {
        bufferInterval: cdk.Duration.minutes(1),
        bufferSize: cdk.Size.mebibytes(1),
        retries: 5,
      });
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        role: destinationRole,
        processor: processor,
      });
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResource('AWS::Lambda::Function');
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          ProcessingConfiguration: {
            Enabled: true,
            Processors: [{
              Type: 'Lambda',
              Parameters: [
                {
                  ParameterName: 'RoleArn',
                  ParameterValue: stack.resolve(destinationRole.roleArn),
                },
                {
                  ParameterName: 'LambdaArn',
                  ParameterValue: stack.resolve(lambdaFunction.functionArn),
                },
                {
                  ParameterName: 'BufferIntervalInSeconds',
                  ParameterValue: '60',
                },
                {
                  ParameterName: 'BufferSizeInMBs',
                  ParameterValue: '1',
                },
                {
                  ParameterName: 'NumberOfRetries',
                  ParameterValue: '5',
                },
              ],
            }],
          },
        },
      });
    });

    it('grants invoke access to the lambda function and delivery stream depends on grant', () => {
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destinationWithBasicLambdaProcessor],
      });

      expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
        PolicyName: 'RedshiftDestinationRoleDefaultPolicyB29BE586',
        Roles: [stack.resolve(destinationRole.roleName)],
        PolicyDocument: {
          Statement: arrayWith(
            {
              Action: 'lambda:InvokeFunction',
              Effect: 'Allow',
              Resource: stack.resolve(lambdaFunction.functionArn),
            },
          ),
        },
      });
      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        DependsOn: ['RedshiftDestinationRoleDefaultPolicyB29BE586'],
      }, ResourcePart.CompleteDefinition);
    });
  });

  describe('s3 backup configuration', () => {
    let destinationRole: iam.Role;

    beforeEach(() => {
      destinationRole = new iam.Role(stack, 'Redshift Destination Role', {
        assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      });
    });

    it('set backupMode to ALL creates resources', () => {
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        role: destinationRole,
        s3Backup: {
          mode: dests.BackupMode.ALL,
          logging: false,
        },
      });
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          S3BackupConfiguration: {
            BucketARN: anything(),
            RoleARN: stack.resolve(destinationRole.roleArn),
          },
          S3BackupMode: 'Enabled',
        },
      });
    });

    it('sets backup configuration if backup bucket provided', () => {
      const backupBucket = new s3.Bucket(stack, 'MyBackupBucket');
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        role: destinationRole,
        s3Backup: {
          bucket: backupBucket,
        },
      });
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          S3BackupConfiguration: {
            BucketARN: stack.resolve(backupBucket.bucketArn),
            CloudWatchLoggingOptions: {
              Enabled: true,
              LogGroupName: anything(),
              LogStreamName: anything(),
            },
            RoleARN: stack.resolve(destinationRole.roleArn),
          },
          S3BackupMode: 'Enabled',
        },
      });
    });

    it('throws error if backup mode set to FAILED_ONLY', () => {
      expect(() => new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        s3Backup: {
          mode: dests.BackupMode.FAILED,
        },
      })).toThrowError('Redshift delivery stream destination only supports ALL and DISABLED BackupMode, given FAILED');
    });

    it('sets full backup configuration', () => {
      const backupBucket = new s3.Bucket(stack, 'MyBackupBucket');
      const key = new kms.Key(stack, 'Key');
      const logGroup = new logs.LogGroup(stack, 'BackupLogGroup');
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        role: destinationRole,
        s3Backup: {
          mode: dests.BackupMode.ALL,
          bucket: backupBucket,
          dataOutputPrefix: 'myBackupPrefix',
          errorOutputPrefix: 'myBackupErrorPrefix',
          bufferingSize: cdk.Size.mebibytes(1),
          bufferingInterval: cdk.Duration.minutes(1),
          compression: dests.Compression.ZIP,
          encryptionKey: key,
          logging: true,
          logGroup: logGroup,
        },
      });
      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          S3BackupConfiguration: {
            BucketARN: stack.resolve(backupBucket.bucketArn),
            CloudWatchLoggingOptions: {
              Enabled: true,
              LogGroupName: stack.resolve(logGroup.logGroupName),
              LogStreamName: anything(),
            },
            RoleARN: stack.resolve(destinationRole.roleArn),
            EncryptionConfiguration: {
              KMSEncryptionConfig: {
                AWSKMSKeyARN: stack.resolve(key.keyArn),
              },
            },
            Prefix: 'myBackupPrefix',
            ErrorOutputPrefix: 'myBackupErrorPrefix',
            BufferingHints: {},
            CompressionFormat: 'ZIP',
          },
          S3BackupMode: 'Enabled',
        },
      });
    });
  });

  describe('buffering', () => {
    it('does not create configuration by default', () => {
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
      });

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          CloudWatchLoggingOptions: {
            BufferingHints: ABSENT,
          },
        },
      });
    });

    it('creates configuration when interval and size provided', () => {
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        bufferingInterval: cdk.Duration.minutes(1),
        bufferingSize: cdk.Size.mebibytes(1),
      });

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          S3Configuration: {
            BufferingHints: {
              IntervalInSeconds: 60,
              SizeInMBs: 1,
            },
          },
        },
      });
    });

    it('validates bufferingInterval', () => {
      const smallDestination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        bufferingInterval: cdk.Duration.seconds(30),
        bufferingSize: cdk.Size.mebibytes(1),
      });
      expect(() => new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [smallDestination],
      })).toThrowError(/Buffering interval must be between 60 and 900 seconds. Buffering interval provided was .* seconds./);

      const largeDestination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        bufferingInterval: cdk.Duration.seconds(30),
        bufferingSize: cdk.Size.mebibytes(1),
      });
      expect(() => new firehose.DeliveryStream(stack, 'DeliveryStream2', {
        destinations: [largeDestination],
      })).toThrowError(/Buffering interval must be between 60 and 900 seconds. Buffering interval provided was .* seconds./);
    });

    it('validates bufferingSize', () => {
      const smallDestination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        bufferingInterval: cdk.Duration.minutes(1),
        bufferingSize: cdk.Size.mebibytes(0),
      });
      expect(() => new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [smallDestination],
      })).toThrowError(/Buffering size must be between 1 and 128 MiBs. Buffering size provided was .* MiBs./);

      const largeDestination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        bufferingInterval: cdk.Duration.minutes(1),
        bufferingSize: cdk.Size.mebibytes(256),
      });
      expect(() => new firehose.DeliveryStream(stack, 'DeliveryStream2', {
        destinations: [largeDestination],
      })).toThrowError(/Buffering size must be between 1 and 128 MiBs. Buffering size provided was .* MiBs./);
    });
  });

  describe('destination encryption', () => {
    it('creates configuration', () => {
      const key = new kms.Key(stack, 'Key');
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        encryptionKey: key,
      });

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::KinesisFirehose::DeliveryStream', {
        RedshiftDestinationConfiguration: {
          S3Configuration: {
            EncryptionConfiguration: {
              KMSEncryptionConfig: {
                AWSKMSKeyARN: stack.resolve(key.keyArn),
              },
            },
          },
        },
      });
    });


    it('grants encrypt/decrypt access to the destination encryptionKey', () => {
      const key = new kms.Key(stack, 'Key');
      const destinationRole = new iam.Role(stack, 'Redshift Destination Role', {
        assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      });
      const destination = new dests.RedshiftCluster(cluster, {
        ...minimalProps,
        encryptionKey: key,
        role: destinationRole,
      });

      new firehose.DeliveryStream(stack, 'DeliveryStream', {
        destinations: [destination],
      });

      expect(stack).toHaveResourceLike('AWS::IAM::Policy', {
        Roles: [stack.resolve(destinationRole.roleName)],
        PolicyDocument: {
          Statement: arrayWith({
            Action: [
              'kms:Decrypt',
              'kms:Encrypt',
              'kms:ReEncrypt*',
              'kms:GenerateDataKey*',
            ],
            Effect: 'Allow',
            Resource: stack.resolve(key.keyArn),
          }),
        },
      });
    });
  });
});
