import { CronJob } from "cron";
import { Message, MessageCreateOptions, MessagePayload } from "discord.js";
import { container } from "tsyringe";

import { Client } from "../../core/Client";
import { EventEmbed } from "../../embeds/EventEmbed";
import { Locales } from "../../i18n/i18n-types";
import { Events, EventsList, HelltideEvent } from "../../types";
import { duration } from "../../utils/Commons";
import { clientSymbol } from "../../utils/Constants";
import { getEvents, getStatus } from "../API";
import { Broadcaster } from "./Broadcaster";
import { getTitle } from "./NotifierUtils";

const refreshInterval = duration.seconds(60);

/**
 * The event notifier handler.
 */
export class EventNotifier {
  /**
   * The client instance.
   * @type {Client}
   * @readonly
   */
  readonly client: Client;

  /**
   * The broadcaster instance.
   * @type {Broadcaster}
   * @readonly
   */
  readonly broadcaster: Broadcaster;

  constructor() {
    this.client = container.resolve<Client>(clientSymbol);
    this.broadcaster = new Broadcaster();

    this.init();
  }

  async init() {
    this.client.logger.info("Event notifier has been initialized.");
    new CronJob("0 */1 * * * *", () => this.refresh(), null, true, "Europe/Brussels").start();
  }

  private async refresh() {
    this.client.logger.info("Refreshing events...");

    const [status, events] = await Promise.all([getStatus(), getEvents()]);

    if (!status || !status.event_service) {
      this.client.logger.info("Event service is not available, skipping...");
      return;
    }

    if (!events) {
      this.client.logger.info("No events found, skipping...");
      return;
    }

    for (let [key, event] of Object.entries(events)) {
      const exist = await this.client.database.notification.findFirst({
        where: {
          type: key,
          timestamp: event.timestamp,
        },
      });

      if (!exist || (exist.refreshTimestamp > 0 && !exist.refreshed)) {
        // If it doesn't exist, create it
        if (!exist) {
          const now = Date.now();
          const eventDate = new Date(event.timestamp * 1000).getTime();
          const delayDate = new Date(event.timestamp * 1000).getTime() + duration.seconds(30);

          // If the event is too recent, skip it
          if (key === Events.Helltide && now < delayDate) {
            this.client.logger.info(`Event ${key} is too recent, waiting...`);
            continue;
          }

          const refreshTimestamp = key === Events.Helltide ? (event as HelltideEvent).refresh : 0;

          try {
            await this.client.database.notification.create({
              data: {
                type: key,
                data: event,
                timestamp: event.timestamp,
                refreshTimestamp: refreshTimestamp,
              },
            });
          } catch (error) {
            this.client.logger.error(`Failed to create event ${key}: ${error.message}`);
          }

          // If the event is too old, skip it
          if (now > eventDate + duration.minutes(5)) {
            this.client.logger.info(`Event ${key} is too old, skipping...`);
            continue;
          }
        }

        // If it exists but it's not refreshed, refresh it
        if (exist && exist.refreshTimestamp && exist.refreshTimestamp > 0 && !exist.refreshed) {
          const now = Date.now();
          const startDate = new Date(exist.timestamp * 1000).getTime();
          const refreshDate = new Date(exist.refreshTimestamp * 1000).getTime();
          const endDate = startDate + duration.hours(1);

          // If now is not between the start and end date, and before the refresh date, skip it
          if (!(now >= startDate && now <= endDate) || now < refreshDate) {
            this.client.logger.info(`Event ${key} is not ready to be refreshed, skipping...`);
            continue;
          }

          try {
            await this.client.database.notification.update({
              where: {
                id: exist.id,
              },
              data: {
                refreshed: true,
              },
            });
          } catch (error) {
            this.client.logger.error(`Failed to refresh event ${key}: ${error.message}`);
          }
        }

        const guilds = await this.client.repository.guild.getAllByEvent(key as EventsList);

        this.client.logger.info(`Found ${guilds.length} guilds with event ${key}.`);

        for (const guild of guilds) {
          this.client.logger.info(`Checking guild ${guild.id}...`);

          const embed = new EventEmbed(key, event);

          let message: string | MessagePayload | MessageCreateOptions = {
            content: getTitle(key, event, guild.locale as Locales),
            embeds: [embed],
          };

          const settings = guild.events.filter((event) => event.type === (key as EventsList));

          if (!settings || settings.length === 0) continue;

          for (let setting of settings) {
            this.client.logger.info(`Event ${key} is enabled, broadcasting to guild ${guild.id}...`);

            if (setting.roleId) {
              message.content += ` - <@&${setting.roleId}>`;
              message.allowedMentions = {
                roles: [setting.roleId],
              };
            }

            // if (setting.schedule) {
            //   // TODO: Implement schedule
            // }

            if (!setting.channelId) {
              this.client.logger.info(`Event ${key} has no channel set, skipping...`);
              continue;
            }

            const response = (await this.broadcaster.broadcast(
              setting.channelId,
              message,
              setting.messageId
            )) as (Message<true> | null)[];

            if (response && response.length >= 1) {
              await this.client.repository.guild.updateEventMessageId(
                guild.guildId,
                key as EventsList,
                setting.channelId,
                response[0]?.id
              );
            }
          }
        }

        this.client.logger.info(`Event ${key} has been broadcasted to ${guilds.length} guilds.`);
      }
    }
  }
}
