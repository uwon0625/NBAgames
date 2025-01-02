"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmiContextProviderPlugin = void 0;
const sdk_provider_1 = require("../api/aws-auth/sdk-provider");
const logging_1 = require("../logging");
/**
 * Plugin to search AMIs for the current account
 */
class AmiContextProviderPlugin {
    constructor(aws) {
        this.aws = aws;
    }
    async getValue(args) {
        const region = args.region;
        const account = args.account;
        // Normally we'd do this only as 'debug', but searching AMIs typically takes dozens
        // of seconds, so be little more verbose about it so users know what is going on.
        (0, logging_1.print)(`Searching for AMI in ${account}:${region}`);
        (0, logging_1.debug)(`AMI search parameters: ${JSON.stringify(args)}`);
        const ec2 = (await (0, sdk_provider_1.initContextProviderSdk)(this.aws, args)).ec2();
        const response = await ec2.describeImages({
            Owners: args.owners,
            Filters: Object.entries(args.filters).map(([key, values]) => ({
                Name: key,
                Values: values,
            })),
        });
        const images = [...(response.Images || [])].filter((i) => i.ImageId !== undefined);
        if (images.length === 0) {
            throw new Error('No AMI found that matched the search criteria');
        }
        // Return the most recent one
        // Note: Date.parse() is not going to respect the timezone of the string,
        // but since we only care about the relative values that is okay.
        images.sort(descending((i) => Date.parse(i.CreationDate || '1970')));
        (0, logging_1.debug)(`Selected image '${images[0].ImageId}' created at '${images[0].CreationDate}'`);
        return images[0].ImageId;
    }
}
exports.AmiContextProviderPlugin = AmiContextProviderPlugin;
/**
 * Make a comparator that sorts in descending order given a sort key extractor
 */
function descending(valueOf) {
    return (a, b) => {
        return valueOf(b) - valueOf(a);
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW1pLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYW1pLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLCtEQUF3RjtBQUV4Rix3Q0FBMEM7QUFFMUM7O0dBRUc7QUFDSCxNQUFhLHdCQUF3QjtJQUNuQyxZQUE2QixHQUFnQjtRQUFoQixRQUFHLEdBQUgsR0FBRyxDQUFhO0lBQUcsQ0FBQztJQUUxQyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQXFCO1FBQ3pDLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7UUFDM0IsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQztRQUU3QixtRkFBbUY7UUFDbkYsaUZBQWlGO1FBQ2pGLElBQUEsZUFBSyxFQUFDLHdCQUF3QixPQUFPLElBQUksTUFBTSxFQUFFLENBQUMsQ0FBQztRQUNuRCxJQUFBLGVBQUssRUFBQywwQkFBMEIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFeEQsTUFBTSxHQUFHLEdBQUcsQ0FBQyxNQUFNLElBQUEscUNBQXNCLEVBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ2pFLE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxDQUFDLGNBQWMsQ0FBQztZQUN4QyxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbkIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO2dCQUM1RCxJQUFJLEVBQUUsR0FBRztnQkFDVCxNQUFNLEVBQUUsTUFBTTthQUNmLENBQUMsQ0FBQztTQUNKLENBQUMsQ0FBQztRQUVILE1BQU0sTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxPQUFPLEtBQUssU0FBUyxDQUFDLENBQUM7UUFFbkYsSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3hCLE1BQU0sSUFBSSxLQUFLLENBQUMsK0NBQStDLENBQUMsQ0FBQztRQUNuRSxDQUFDO1FBRUQsNkJBQTZCO1FBQzdCLHlFQUF5RTtRQUN6RSxpRUFBaUU7UUFDakUsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFlBQVksSUFBSSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFckUsSUFBQSxlQUFLLEVBQUMsbUJBQW1CLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLGlCQUFpQixNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxHQUFHLENBQUMsQ0FBQztRQUN0RixPQUFPLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFRLENBQUM7SUFDNUIsQ0FBQztDQUNGO0FBbkNELDREQW1DQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxVQUFVLENBQUksT0FBeUI7SUFDOUMsT0FBTyxDQUFDLENBQUksRUFBRSxDQUFJLEVBQUUsRUFBRTtRQUNwQixPQUFPLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDakMsQ0FBQyxDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgQW1pQ29udGV4dFF1ZXJ5IH0gZnJvbSAnQGF3cy1jZGsvY2xvdWQtYXNzZW1ibHktc2NoZW1hJztcbmltcG9ydCB7IHR5cGUgU2RrUHJvdmlkZXIsIGluaXRDb250ZXh0UHJvdmlkZXJTZGsgfSBmcm9tICcuLi9hcGkvYXdzLWF1dGgvc2RrLXByb3ZpZGVyJztcbmltcG9ydCB7IENvbnRleHRQcm92aWRlclBsdWdpbiB9IGZyb20gJy4uL2FwaS9wbHVnaW4nO1xuaW1wb3J0IHsgZGVidWcsIHByaW50IH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5cbi8qKlxuICogUGx1Z2luIHRvIHNlYXJjaCBBTUlzIGZvciB0aGUgY3VycmVudCBhY2NvdW50XG4gKi9cbmV4cG9ydCBjbGFzcyBBbWlDb250ZXh0UHJvdmlkZXJQbHVnaW4gaW1wbGVtZW50cyBDb250ZXh0UHJvdmlkZXJQbHVnaW4ge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGF3czogU2RrUHJvdmlkZXIpIHt9XG5cbiAgcHVibGljIGFzeW5jIGdldFZhbHVlKGFyZ3M6IEFtaUNvbnRleHRRdWVyeSkge1xuICAgIGNvbnN0IHJlZ2lvbiA9IGFyZ3MucmVnaW9uO1xuICAgIGNvbnN0IGFjY291bnQgPSBhcmdzLmFjY291bnQ7XG5cbiAgICAvLyBOb3JtYWxseSB3ZSdkIGRvIHRoaXMgb25seSBhcyAnZGVidWcnLCBidXQgc2VhcmNoaW5nIEFNSXMgdHlwaWNhbGx5IHRha2VzIGRvemVuc1xuICAgIC8vIG9mIHNlY29uZHMsIHNvIGJlIGxpdHRsZSBtb3JlIHZlcmJvc2UgYWJvdXQgaXQgc28gdXNlcnMga25vdyB3aGF0IGlzIGdvaW5nIG9uLlxuICAgIHByaW50KGBTZWFyY2hpbmcgZm9yIEFNSSBpbiAke2FjY291bnR9OiR7cmVnaW9ufWApO1xuICAgIGRlYnVnKGBBTUkgc2VhcmNoIHBhcmFtZXRlcnM6ICR7SlNPTi5zdHJpbmdpZnkoYXJncyl9YCk7XG5cbiAgICBjb25zdCBlYzIgPSAoYXdhaXQgaW5pdENvbnRleHRQcm92aWRlclNkayh0aGlzLmF3cywgYXJncykpLmVjMigpO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZWMyLmRlc2NyaWJlSW1hZ2VzKHtcbiAgICAgIE93bmVyczogYXJncy5vd25lcnMsXG4gICAgICBGaWx0ZXJzOiBPYmplY3QuZW50cmllcyhhcmdzLmZpbHRlcnMpLm1hcCgoW2tleSwgdmFsdWVzXSkgPT4gKHtcbiAgICAgICAgTmFtZToga2V5LFxuICAgICAgICBWYWx1ZXM6IHZhbHVlcyxcbiAgICAgIH0pKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGltYWdlcyA9IFsuLi4ocmVzcG9uc2UuSW1hZ2VzIHx8IFtdKV0uZmlsdGVyKChpKSA9PiBpLkltYWdlSWQgIT09IHVuZGVmaW5lZCk7XG5cbiAgICBpZiAoaW1hZ2VzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBBTUkgZm91bmQgdGhhdCBtYXRjaGVkIHRoZSBzZWFyY2ggY3JpdGVyaWEnKTtcbiAgICB9XG5cbiAgICAvLyBSZXR1cm4gdGhlIG1vc3QgcmVjZW50IG9uZVxuICAgIC8vIE5vdGU6IERhdGUucGFyc2UoKSBpcyBub3QgZ29pbmcgdG8gcmVzcGVjdCB0aGUgdGltZXpvbmUgb2YgdGhlIHN0cmluZyxcbiAgICAvLyBidXQgc2luY2Ugd2Ugb25seSBjYXJlIGFib3V0IHRoZSByZWxhdGl2ZSB2YWx1ZXMgdGhhdCBpcyBva2F5LlxuICAgIGltYWdlcy5zb3J0KGRlc2NlbmRpbmcoKGkpID0+IERhdGUucGFyc2UoaS5DcmVhdGlvbkRhdGUgfHwgJzE5NzAnKSkpO1xuXG4gICAgZGVidWcoYFNlbGVjdGVkIGltYWdlICcke2ltYWdlc1swXS5JbWFnZUlkfScgY3JlYXRlZCBhdCAnJHtpbWFnZXNbMF0uQ3JlYXRpb25EYXRlfSdgKTtcbiAgICByZXR1cm4gaW1hZ2VzWzBdLkltYWdlSWQhO1xuICB9XG59XG5cbi8qKlxuICogTWFrZSBhIGNvbXBhcmF0b3IgdGhhdCBzb3J0cyBpbiBkZXNjZW5kaW5nIG9yZGVyIGdpdmVuIGEgc29ydCBrZXkgZXh0cmFjdG9yXG4gKi9cbmZ1bmN0aW9uIGRlc2NlbmRpbmc8QT4odmFsdWVPZjogKHg6IEEpID0+IG51bWJlcikge1xuICByZXR1cm4gKGE6IEEsIGI6IEEpID0+IHtcbiAgICByZXR1cm4gdmFsdWVPZihiKSAtIHZhbHVlT2YoYSk7XG4gIH07XG59XG4iXX0=