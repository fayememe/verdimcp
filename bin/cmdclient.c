/* Minimal headless Verdi command-client (libnclt).
 *
 * Usage: cmdclient <port> [--json] [--hold SEC] <cmd> [cmd...]
 *
 * Default output is TSV:  OK|ERR \t command \t result
 * JSON output is JSONL:   {"type":"connect"|"result"|"event"|"error",...}
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "cmdclt.h"

static int g_json = 0;
static int g_cmd_index = -1;

static void usage(const char *prog) {
    if (g_json) {
        printf("{\"type\":\"error\",\"code\":\"usage\",\"message\":\"usage: %s <port> [--json] [--hold SEC] <cmd> [cmd...]\"}\n", prog);
    } else {
        fprintf(stderr, "usage: %s <port> [--json] [--hold SEC] <cmd> [cmd...]\n", prog);
    }
}

static void json_string(const char *s) {
    const unsigned char *p = (const unsigned char *)(s ? s : "");
    putchar('"');
    for (; *p; p++) {
        switch (*p) {
            case '"':  fputs("\\\"", stdout); break;
            case '\\': fputs("\\\\", stdout); break;
            case '\n': fputs("\\n", stdout); break;
            case '\r': fputs("\\r", stdout); break;
            case '\t': fputs("\\t", stdout); break;
            case '\b': fputs("\\b", stdout); break;
            case '\f': fputs("\\f", stdout); break;
            default:
                if (*p < 0x20) {
                    printf("\\u%04x", *p);
                } else {
                    putchar(*p);
                }
        }
    }
    putchar('"');
}

static void EventCB(char *event, void *clientData, char *callData) {
    (void)clientData;
    if (g_json) {
        printf("{\"type\":\"event\",\"cmd_index\":%d,\"event\":", g_cmd_index);
        json_string(event ? event : "");
        fputs(",\"data\":", stdout);
        json_string(callData ? callData : "");
        fputs("}\n", stdout);
    } else {
        printf("EVENT\t%s\t%s\n", event ? event : "", callData ? callData : "");
    }
    fflush(stdout);
}

int main(int argc, char **argv) {
    if (argc < 3) {
        usage(argv[0]);
        return 64;
    }

    char *end = NULL;
    long port = strtol(argv[1], &end, 10);
    if (end == argv[1] || *end != '\0' || port <= 0 || port > 65535) {
        usage(argv[0]);
        return 64;
    }

    int hold = 0;
    int i = 2;
    while (i < argc) {
        if (strcmp(argv[i], "--json") == 0) {
            g_json = 1;
            i++;
        } else if (strcmp(argv[i], "--hold") == 0 && i + 1 < argc) {
            hold = atoi(argv[i + 1]);
            i += 2;
        } else {
            break;
        }
    }
    if (i >= argc) {
        usage(argv[0]);
        return 64;
    }
    int first = i;

    CMDCLT c = CmdCltCreate(1);
    if (!CmdCltConnect(c, (int)port, NULL, 20)) {
        if (g_json) {
            printf("{\"type\":\"error\",\"code\":\"connect_failed\",\"message\":\"connect to port %ld failed\"}\n", port);
        } else {
            fprintf(stderr, "connect to port %ld failed\n", port);
        }
        return 2;
    }
    if (g_json) {
        printf("{\"type\":\"connect\",\"ok\":true,\"port\":%ld}\n", port);
        fflush(stdout);
    }

    CmdCltAddEventCallback(c, (char *)"AllEvents", (CmdCltEventCB)EventCB, NULL);

    int rc = 0;
    for (int k = first; k < argc; k++) {
        g_cmd_index = k - first;
        char *rv = NULL;
        char ok = CmdCltCallCommand(c, argv[k], 0, &rv);
        if (g_json) {
            printf("{\"type\":\"result\",\"ok\":%s,\"command\":", ok ? "true" : "false");
            json_string(argv[k]);
            fputs(",\"result\":", stdout);
            json_string(rv ? rv : "");
            fputs("}\n", stdout);
        } else {
            printf("%s\t%s\t%s\n", ok ? "OK" : "ERR", argv[k], rv ? rv : "(null)");
        }
        fflush(stdout);
        CmdCltCheckForEvents(c);
        if (!ok) {
            rc = 1;
        }
    }

    if (hold > 0) {
        if (g_json) {
            printf("{\"type\":\"hold\",\"seconds\":%d}\n", hold);
        } else {
            printf("HOLD\t%d\n", hold);
        }
        fflush(stdout);
        for (int t = 0; t < hold * 5; t++) {
            usleep(200000);
            CmdCltCheckForEvents(c);
        }
        if (g_json) {
            printf("{\"type\":\"hold_end\"}\n");
        } else {
            printf("HOLD_END\n");
        }
        fflush(stdout);
    }

    CmdCltDestroy(c);
    return rc;
}
