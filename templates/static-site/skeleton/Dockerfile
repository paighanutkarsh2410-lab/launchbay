FROM nginxinc/nginx-unprivileged:1.27-alpine
# Apply Alpine security fixes newer than the base image, then drop back to the nginx user.
USER root
RUN apk upgrade --no-cache
USER 101
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site /usr/share/nginx/html
EXPOSE 8080
